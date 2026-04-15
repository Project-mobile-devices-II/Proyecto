use tokio::net::{TcpListener, TcpStream};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use std::sync::Arc;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use rand::Rng;
use std::net::SocketAddr;

use mongodb::{Client, Collection};
use mongodb::bson::{doc, DateTime};
use mongodb::options::UpdateOptions;

use sha1::{Sha1, Digest};
use base64::{engine::general_purpose, Engine as _};

// ===================== MODELOS =====================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Player {
    addr: SocketAddr,
    client_id: String,
    nick: String,
    room_id: String,
    score: f64,
    prediction: Option<String>,
    ready: bool,
    white_dice: Vec<u8>,
    red_die: u8,
    blue_die: u8,
    remaining_dice: Vec<u8>,
    submitted_combination: Option<Vec<u8>>,
    used_hidden: Vec<String>,
    round_score: f64,
    prediction_submitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameState {
    round: u8,
    phase: String,
    players: Vec<Player>,
    white_dice: Vec<u8>,
    submissions: HashMap<String, Vec<u8>>,
    round_scores: HashMap<String, f64>,
    presentation_order: Vec<String>,
    current_presentation: u8,
    timer_active: bool,
}

// ===================== TYPES =====================

type Clients = Arc<TokioMutex<HashMap<SocketAddr, mpsc::UnboundedSender<String>>>>;
type Rooms = Arc<TokioMutex<HashMap<String, GameState>>>;

// ===================== MAIN =====================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {

    let listener = TcpListener::bind("0.0.0.0:5000").await?;

    let clients: Clients = Arc::new(TokioMutex::new(HashMap::new()));
    let rooms: Rooms = Arc::new(TokioMutex::new(HashMap::new()));

    let mongo_client = Client::with_uri_str(
        "mongodb://ahian:27040505@127.0.0.1:27017/?authSource=admin"
    ).await?;

    let db = mongo_client.database("dado_triple");

    let players_coll: Collection<_> = db.collection("players");
    let rooms_coll: Collection<_> = db.collection("rooms");
    let moves_coll: Collection<_> = db.collection("moves");

    println!("🚀 SERVER FUNCIONANDO CON MONGO LOCAL");

    loop {
        let (socket, addr) = listener.accept().await?;

        tokio::spawn(handle_connection(
            socket,
            addr,
            clients.clone(),
            rooms.clone(),
            players_coll.clone(),
            rooms_coll.clone(),
            moves_coll.clone(),
        ));
    }
}

// ===================== CONNECTION =====================

async fn handle_connection(
    mut socket: TcpStream,
    addr: SocketAddr,
    clients: Clients,
    rooms: Rooms,
    players_coll: Collection<mongodb::bson::Document>,
    rooms_coll: Collection<mongodb::bson::Document>,
    moves_coll: Collection<mongodb::bson::Document>,
) {
    println!("🔌 Conectado: {}", addr);

    let mut buffer = [0; 2048];
    let n = match socket.read(&mut buffer).await {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buffer[..n]);

    if let Some(key_line) = request.lines().find(|l| l.starts_with("Sec-WebSocket-Key:")) {
        let key = key_line.split(':').nth(1).unwrap().trim();

        let mut hasher = Sha1::new();
        hasher.update(format!("{}258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key));

        let accept = general_purpose::STANDARD.encode(hasher.finalize());

        let response = format!(
            "HTTP/1.1 101 Switching Protocols\r\n\
            Upgrade: websocket\r\n\
            Connection: Upgrade\r\n\
            Sec-WebSocket-Accept: {}\r\n\r\n",
            accept
        );

        socket.write_all(response.as_bytes()).await.unwrap();
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    clients.lock().await.insert(addr, tx);

    let (mut reader, mut writer) = socket.into_split();

    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let _ = send_ws_text(&mut writer, &msg).await;
        }
    });

    loop {
        let mut header = [0u8; 2];
        if reader.read_exact(&mut header).await.is_err() {
            break;
        }

        let mut len = (header[1] & 0x7F) as usize;

        if len == 126 {
            let mut ext = [0u8; 2];
            reader.read_exact(&mut ext).await.unwrap();
            len = u16::from_be_bytes(ext) as usize;
        }

        let mut mask = [0u8; 4];
        reader.read_exact(&mut mask).await.unwrap();

        let mut encoded = vec![0u8; len];
        reader.read_exact(&mut encoded).await.unwrap();

        let decoded: Vec<u8> = encoded.iter().enumerate()
            .map(|(i, b)| b ^ mask[i % 4])
            .collect();

        let msg = String::from_utf8_lossy(&decoded).to_string();

        println!("📩 {}", msg);

        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&msg) {
            let cid = data["client_id"].as_str().unwrap_or("unknown");

            let options = UpdateOptions::builder().upsert(true).build();

            let _ = moves_coll.update_one(
                doc! { "client_id": cid },
                doc! {
                    "$push": {
                        "actions": {
                            "raw": msg.clone(),
                            "timestamp": DateTime::now()
                        }
                    }
                },
                options,
            ).await;
        }

        process_message(
            &msg,
            &addr,
            &clients,
            &rooms,
            &players_coll,
            &rooms_coll,
        ).await;
    }

    println!("❌ Desconectado {}", addr);
    clients.lock().await.remove(&addr);
    handle_disconnect(&addr, &clients, &rooms, &players_coll).await;
}

// ===================== LOGICA =====================

async fn process_message(
    msg: &str,
    addr: &SocketAddr,
    clients: &Clients,
    rooms: &Rooms,
    players_coll: &Collection<mongodb::bson::Document>,
    rooms_coll: &Collection<mongodb::bson::Document>,
) {

    let data: serde_json::Value = match serde_json::from_str(msg) {
        Ok(v) => v,
        Err(_) => return,
    };

    let t = match data["type"].as_str() {
        Some(v) => v,
        None => return,
    };

    match t {

        // ================= CREATE ROOM =================
        "CREATE_ROOM" => {

            let client_id = data["client_id"].as_str().unwrap_or("");
            let room_id = generate_code();

            println!("🏠 Nueva sala {}", room_id);

            let _ = rooms_coll.insert_one(doc! {
                "room_id": &room_id,
                "created_at": DateTime::now()
            }, None).await;

            let mut room = GameState {
                round: 1,
                phase: "lobby".to_string(),
                players: vec![],
                white_dice: vec![],
                submissions: HashMap::new(),
                round_scores: HashMap::new(),
                presentation_order: vec![],
                current_presentation: 0,
                timer_active: false,
            };

            room.players.push(Player {
                addr: *addr,
                client_id: client_id.to_string(),
                nick: "Anon".to_string(),
                room_id: room_id.clone(),
                score: 0.0,
                prediction: None,
                ready: false,
                white_dice: vec![],
                red_die: 0,
                blue_die: 0,
                remaining_dice: vec![],
                submitted_combination: None,
                used_hidden: vec![],
                round_score: 0.0,
                prediction_submitted: false,
            });

            rooms.lock().await.insert(room_id.clone(), room);

            send_to_client(clients, addr, serde_json::json!({
                "type": "ROOM_CREATED",
                "room_id": room_id
            })).await;
        }

        // ================= JOIN ROOM =================
        "JOIN_ROOM" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("🔍 {} buscando sala {}", client_id, room_id);

            let rooms_lock = rooms.lock().await;

            if rooms_lock.contains_key(&room_id) {
                drop(rooms_lock);
                send_to_client(clients, addr, serde_json::json!({
                    "type": "ROOM_JOINED",
                    "room_id": room_id
                })).await;
            } else {
                drop(rooms_lock);
                send_to_client(clients, addr, serde_json::json!({
                    "type": "ERROR",
                    "message": "Sala no encontrada"
                })).await;
            }
        }

        // ================= JOIN =================
        "JOIN" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let nick = data["nick"].as_str().unwrap_or("Anon");
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("👤 {} entra a {}", nick, room_id);

            {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {

                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        p.nick = nick.to_string();
                        p.addr = *addr;
                    } else {
                        room.players.push(Player {
                            addr: *addr,
                            client_id: client_id.to_string(),
                            nick: nick.to_string(),
                            room_id: room_id.clone(),
                            score: 0.0,
                            prediction: None,
                            ready: false,
                            white_dice: vec![],
                            red_die: 0,
                            blue_die: 0,
                            remaining_dice: vec![],
                            submitted_combination: None,
                            used_hidden: vec![],
                            round_score: 0.0,
                            prediction_submitted: false,
                        });
                    }

                    let options = UpdateOptions::builder().upsert(true).build();

                    let _ = players_coll.update_one(
                        doc! { "client_id": client_id },
                        doc! {
                            "$set": {
                                "nick": nick,
                                "room_id": &room_id,
                                "last_seen": DateTime::now()
                            }
                        },
                        options,
                    ).await;
                }
            }

            broadcast_room(&room_id, clients, rooms).await;
        }

        // ================= READY =================
        "READY" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            {
                let mut rooms_lock = rooms.lock().await;
                if let Some(room) = rooms_lock.get_mut(&room_id) {
                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        p.ready = !p.ready;
                    }
                }
            }

            broadcast_room(&room_id, clients, rooms).await;
        }

        // ================= START GAME =================
        "START_GAME" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("🎮 Iniciando juego en sala {}", room_id);

            let can_start = {
                let rooms_lock = rooms.lock().await;
                if let Some(room) = rooms_lock.get(&room_id) {
                    let is_owner = room.players.first()
                        .map(|p| p.client_id == client_id)
                        .unwrap_or(false);
                    let all_ready = room.players.len() >= 4
                        && room.players.iter().all(|p| p.ready);
                    is_owner && all_ready
                } else {
                    false
                }
            };

            if !can_start {
                send_to_client(clients, addr, serde_json::json!({
                    "type": "ERROR",
                    "message": "No se puede iniciar el juego"
                })).await;
                return;
            }

            start_round(&room_id, clients, rooms).await;
        }

        // ================= ROLL DICE =================
        "ROLL_DICE" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("🎲 {} lanzando dados", client_id);

            let all_rolled = {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {
                    if room.phase != "rolling" {
                        return;
                    }

                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        if p.white_dice.is_empty() {
                            let mut rng = rand::thread_rng();
                            p.white_dice = (0..9).map(|_| rng.gen_range(1..=6)).collect();
                            p.red_die = rng.gen_range(1..=6);
                            p.blue_die = rng.gen_range(1..=6);
                            p.remaining_dice = p.white_dice.clone();
                        }
                    }

                    room.players.iter().all(|p| !p.white_dice.is_empty())
                } else {
                    false
                }
            };

            // broadcast para que todos vean los dados blancos de cada jugador
            broadcast_room(&room_id, clients, rooms).await;

            // si todos lanzaron, pasar a fase de predicciones
            if all_rolled {
                println!("✅ Todos lanzaron dados en {}", room_id);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                set_phase(&room_id, "prediction", clients, rooms).await;
            }
        }

        // ================= SUBMIT PREDICTION =================
        "SUBMIT_PREDICTION" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");
            let prediction = data["prediction"].as_str().unwrap_or("");

            if !["ZERO", "MIN", "MORE", "MAX"].contains(&prediction) {
                return;
            }

            println!("🔮 {} predice {}", client_id, prediction);

            let all_predicted = {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {
                    if room.phase != "prediction" {
                        return;
                    }

                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        if !p.prediction_submitted {
                            p.prediction = Some(prediction.to_string());
                            p.prediction_submitted = true;
                        }
                    }

                    room.players.iter().all(|p| p.prediction_submitted)
                } else {
                    false
                }
            };

            if all_predicted {
                println!("✅ Todos predijeron en {}", room_id);
                set_phase(&room_id, "presenting", clients, rooms).await;
                start_presentation_timer(&room_id, clients, rooms).await;
            }
        }

        // ================= SUBMIT COMBINATION =================
        "SUBMIT_COMBINATION" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");
            let dice: Vec<u8> = data["dice"].as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| v.as_u64().map(|n| n as u8))
                .collect();

            let use_red = data["use_red"].as_bool().unwrap_or(false);
            let use_blue = data["use_blue"].as_bool().unwrap_or(false);

            if dice.len() != 3 {
                send_to_client(clients, addr, serde_json::json!({
                    "type": "ERROR",
                    "message": "Debes seleccionar exactamente 3 dados"
                })).await;
                return;
            }

            println!("🎯 {} presenta combinación {:?}", client_id, dice);

            let all_submitted = {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {
                    if room.phase != "presenting" {
                        return;
                    }

                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        if p.submitted_combination.is_none() {
                            // validar que los dados existen en remaining_dice
                            let mut temp_remaining = p.remaining_dice.clone();
                            let mut valid = true;
                            let mut used_hidden = vec![];

                            for &d in &dice {
                                if use_red && d == p.red_die && !used_hidden.contains(&"red".to_string()) {
                                    used_hidden.push("red".to_string());
                                    continue;
                                }
                                if use_blue && d == p.blue_die && !used_hidden.contains(&"blue".to_string()) {
                                    used_hidden.push("blue".to_string());
                                    continue;
                                }
                                if let Some(pos) = temp_remaining.iter().position(|&x| x == d) {
                                    temp_remaining.remove(pos);
                                } else {
                                    valid = false;
                                    break;
                                }
                            }

                            if valid {
                                p.remaining_dice = temp_remaining;
                                p.submitted_combination = Some(dice.clone());
                                p.used_hidden = used_hidden;
                            }
                        }
                    }

                    room.players.iter().all(|p| p.submitted_combination.is_some())
                } else {
                    false
                }
            };

            broadcast_room(&room_id, clients, rooms).await;

            if all_submitted {
                println!("✅ Todos presentaron en {}", room_id);
                evaluate_combinations(&room_id, clients, rooms).await;
            }
        }

        // ================= LEAVE ROOM =================
        "LEAVE_ROOM" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("🚪 {} saliendo de {}", client_id, room_id);

            let _ = players_coll.update_one(
                doc! { "client_id": client_id },
                doc! { "$set": { "room_id": "", "last_seen": DateTime::now() } },
                None,
            ).await;

            let is_owner;

            {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {

                    is_owner = room.players.first()
                        .map(|p| p.client_id == client_id)
                        .unwrap_or(false);

                    if is_owner {
                        rooms_lock.remove(&room_id);
                    } else {
                        room.players.retain(|p| p.client_id != client_id);
                    }

                } else {
                    return;
                }
            }

            if is_owner {
                let _ = rooms_coll.delete_one(
                    doc! { "room_id": &room_id }, None
                ).await;
            } else {
                broadcast_room(&room_id, clients, rooms).await;
            }
        }

        _ => {}
    }
}

// ===================== GAME LOGIC =====================

async fn start_round(
    room_id: &str,
    clients: &Clients,
    rooms: &Rooms,
) {
    println!("🔄 Iniciando ronda en sala {}", room_id);

    {
        let mut rooms_lock = rooms.lock().await;
        if let Some(room) = rooms_lock.get_mut(room_id) {
            room.phase = "rolling".to_string();
            room.submissions.clear();
            room.round_scores.clear();
            room.presentation_order.clear();
            room.current_presentation = 0;

            for p in room.players.iter_mut() {
                p.white_dice = vec![];
                p.red_die = 0;
                p.blue_die = 0;
                p.remaining_dice = vec![];
                p.submitted_combination = None;
                p.used_hidden = vec![];
                p.round_score = 0.0;
                p.prediction = None;
                p.prediction_submitted = false;
            }
        }
    }

    broadcast_room(room_id, clients, rooms).await;

    // timer de 7 segundos para lanzar dados
    let room_id_clone = room_id.to_string();
    let clients_clone = clients.clone();
    let rooms_clone = rooms.clone();

    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(7)).await;

        // auto-lanzar dados para jugadores que no lo hicieron
        {
            let mut rooms_lock = rooms_clone.lock().await;
            if let Some(room) = rooms_lock.get_mut(&room_id_clone) {
                if room.phase == "rolling" {
                    let mut rng = rand::thread_rng();
                    for p in room.players.iter_mut() {
                        if p.white_dice.is_empty() {
                            p.white_dice = (0..9).map(|_| rng.gen_range(1..=6)).collect();
                            p.red_die = rng.gen_range(1..=6);
                            p.blue_die = rng.gen_range(1..=6);
                            p.remaining_dice = p.white_dice.clone();
                        }
                    }
                }
            }
        }

        broadcast_room(&room_id_clone, &clients_clone, &rooms_clone).await;
        set_phase(&room_id_clone, "prediction", &clients_clone, &rooms_clone).await;
    });
}

async fn set_phase(
    room_id: &str,
    phase: &str,
    clients: &Clients,
    rooms: &Rooms,
) {
    println!("📌 Fase {} en sala {}", phase, room_id);

    {
        let mut rooms_lock = rooms.lock().await;
        if let Some(room) = rooms_lock.get_mut(room_id) {
            room.phase = phase.to_string();
        }
    }

    broadcast_room(room_id, clients, rooms).await;
}

async fn start_presentation_timer(
    room_id: &str,
    clients: &Clients,
    rooms: &Rooms,
) {
    let room_id_clone = room_id.to_string();
    let clients_clone = clients.clone();
    let rooms_clone = rooms.clone();

    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(7)).await;

        let all_submitted = {
            let rooms_lock = rooms_clone.lock().await;
            rooms_lock.get(&room_id_clone)
                .map(|r| r.players.iter().all(|p| p.submitted_combination.is_some()))
                .unwrap_or(false)
        };

        if !all_submitted {
            // auto-submit para jugadores que no presentaron
            {
                let mut rooms_lock = rooms_clone.lock().await;
                if let Some(room) = rooms_lock.get_mut(&room_id_clone) {
                    if room.phase == "presenting" {
                        let mut rng = rand::thread_rng();
                        for p in room.players.iter_mut() {
                            if p.submitted_combination.is_none() && p.remaining_dice.len() >= 3 {
                                let combo = vec![
                                    p.remaining_dice[0],
                                    p.remaining_dice[1],
                                    p.remaining_dice[2],
                                ];
                                let temp: Vec<u8> = p.remaining_dice[3..].to_vec();
                                p.remaining_dice = temp;
                                p.submitted_combination = Some(combo);
                                let _ = rng.gen_range(1..=6); // consume rng
                            }
                        }
                    }
                }
            }

            evaluate_combinations(&room_id_clone, &clients_clone, &rooms_clone).await;
        }
    });
}

fn classify_combination(dice: &[u8]) -> (&'static str, u8) {
    let mut sorted = dice.to_vec();
    sorted.sort();

    // Triple
    if sorted[0] == sorted[1] && sorted[1] == sorted[2] {
        return ("triple", sorted[2]);
    }

    // Escalera (consecutivos, 6-1 no cuenta)
    if sorted[2] == sorted[1] + 1 && sorted[1] == sorted[0] + 1 {
        return ("escalera", sorted[2]);
    }

    // Doble
    if sorted[0] == sorted[1] || sorted[1] == sorted[2] {
        let high = if sorted[0] == sorted[1] { sorted[0] } else { sorted[2] };
        return ("doble", high);
    }

    // Sencillo
    ("sencillo", sorted[2])
}

fn combination_rank(combo_type: &str) -> u8 {
    match combo_type {
        "triple" => 4,
        "escalera" => 3,
        "doble" => 2,
        "sencillo" => 1,
        _ => 0,
    }
}

async fn evaluate_combinations(
    room_id: &str,
    clients: &Clients,
    rooms: &Rooms,
) {
    println!("⚖️ Evaluando combinaciones en {}", room_id);

    let points_table = [6.0f64, 3.0, 1.0, 0.0];

    {
        let mut rooms_lock = rooms.lock().await;
        if let Some(room) = rooms_lock.get_mut(room_id) {

            // recolectar combinaciones
            let mut combos: Vec<(String, &'static str, u8, Vec<u8>)> = vec![];

            for p in room.players.iter() {
                if let Some(combo) = &p.submitted_combination {
                    let (combo_type, high) = classify_combination(combo);
                    combos.push((p.client_id.clone(), combo_type, high, combo.clone()));
                }
            }

            // ordenar por rank desc, luego por high desc
            combos.sort_by(|a, b| {
                let rank_a = combination_rank(a.1);
                let rank_b = combination_rank(b.1);
                if rank_a != rank_b {
                    return rank_b.cmp(&rank_a);
                }
                b.2.cmp(&a.2)
            });

            // asignar puntos con empates
            let n = combos.len();
            let mut i = 0;
            while i < n {
                let mut j = i;

                // encontrar grupo de empate
                while j + 1 < n
                    && combination_rank(combos[j].1) == combination_rank(combos[j+1].1)
                    && combos[j].2 == combos[j+1].2
                {
                    j += 1;
                }

                // sumar puntos del grupo y dividir
                let group_size = j - i + 1;
                let total_points: f64 = (i..=j)
                    .map(|k| if k < points_table.len() { points_table[k] } else { 0.0 })
                    .sum();
                let each_points = total_points / group_size as f64;

                for k in i..=j {
                    let cid = &combos[k].0.clone();
                    if let Some(p) = room.players.iter_mut().find(|p| &p.client_id == cid) {
                        p.round_score += each_points;
                    }
                    room.round_scores.insert(cid.clone(), each_points);
                }

                i = j + 1;
            }

            // determinar orden para siguiente presentación
            // el ganador de esta ronda va primero
            let mut order: Vec<(String, f64)> = room.players.iter()
                .map(|p| (p.client_id.clone(), p.round_score))
                .collect();
            order.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            room.presentation_order = order.iter().map(|(id, _)| id.clone()).collect();

            // resetear combinación para siguiente presentación
            for p in room.players.iter_mut() {
                p.submitted_combination = None;
            }

            room.current_presentation += 1;

            println!("📊 Presentación {} completada", room.current_presentation);
        }
    }

    broadcast_room(room_id, clients, rooms).await;

    // verificar si hay más presentaciones o terminar ronda
    let (current_pres, round) = {
        let rooms_lock = rooms.lock().await;
        rooms_lock.get(room_id)
            .map(|r| (r.current_presentation, r.round))
            .unwrap_or((0, 0))
    };

    if current_pres < 3 {
        // hay más presentaciones
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        set_phase(room_id, "presenting", clients, rooms).await;
        start_presentation_timer(room_id, clients, rooms).await;
    } else {
        // fin de ronda
        end_round(room_id, clients, rooms).await;
    }
}

async fn end_round(
    room_id: &str,
    clients: &Clients,
    rooms: &Rooms,
) {
    println!("🏁 Fin de ronda en {}", room_id);

    {
        let mut rooms_lock = rooms.lock().await;
        if let Some(room) = rooms_lock.get_mut(room_id) {

            // revelar dados ocultos y calcular predicciones
            for p in room.players.iter_mut() {
                let round_pts = p.round_score;

                let prediction_correct = match p.prediction.as_deref() {
                    Some("ZERO") => round_pts == 0.0,
                    Some("MIN") => round_pts > 0.0 && round_pts < 7.0,
                    Some("MORE") => round_pts >= 7.0 && round_pts <= 10.0,
                    Some("MAX") => round_pts > 10.0,
                    _ => false,
                };

                if prediction_correct {
                    if p.prediction.as_deref() == Some("ZERO") {
                        p.score += 40.0;
                        println!("🎯 {} predijo ZERO correctamente! +40", p.nick);
                    } else {
                        p.score += round_pts * 2.0;
                        println!("🎯 {} predijo correctamente! +{}", p.nick, round_pts * 2.0);
                    }
                } else {
                    p.score += round_pts;
                }
            }

            room.round += 1;
            room.phase = "round_end".to_string();
        }
    }

    broadcast_room(room_id, clients, rooms).await;

    // verificar si el juego terminó
    let (round, player_count) = {
        let rooms_lock = rooms.lock().await;
        rooms_lock.get(room_id)
            .map(|r| (r.round, r.players.len()))
            .unwrap_or((0, 0))
    };

    if round > 4 {
        // fin del juego
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        set_phase(room_id, "game_over", clients, rooms).await;
        println!("🏆 Juego terminado en {}", room_id);
    } else {
        // siguiente ronda después de 5 segundos
        let room_id_clone = room_id.to_string();
        let clients_clone = clients.clone();
        let rooms_clone = rooms.clone();

        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            start_round(&room_id_clone, &clients_clone, &rooms_clone).await;
        });
    }
}

// ===================== HANDLE DISCONNECT =====================

async fn handle_disconnect(
    addr: &SocketAddr,
    clients: &Clients,
    rooms: &Rooms,
    players_coll: &Collection<mongodb::bson::Document>,
) {
    let mut rooms_to_broadcast = vec![];
    let mut client_id_found = String::new();

    {
        let mut rooms_lock = rooms.lock().await;
        let mut empty_rooms = vec![];

        for (room_id, room) in rooms_lock.iter_mut() {

            let was_owner = room.players.first()
                .map(|p| p.addr == *addr)
                .unwrap_or(false);

            if let Some(p) = room.players.iter().find(|p| p.addr == *addr) {
                client_id_found = p.client_id.clone();
            }

            room.players.retain(|p| p.addr != *addr);

            if room.players.is_empty() {
                empty_rooms.push(room_id.clone());
                continue;
            }

            if was_owner {
                println!("👑 Nuevo owner: {}", room.players[0].nick);
            }

            rooms_to_broadcast.push(room_id.clone());
        }

        for room_id in empty_rooms {
            rooms_lock.remove(&room_id);
            println!("🗑️ Sala {} eliminada por quedarse vacía", room_id);
        }
    }

    if !client_id_found.is_empty() {
        let _ = players_coll.update_one(
            doc! { "client_id": &client_id_found },
            doc! { "$set": { "room_id": "", "last_seen": DateTime::now() } },
            None,
        ).await;
    }

    for room_id in rooms_to_broadcast {
        broadcast_room(&room_id, clients, rooms).await;
    }
}

// ===================== HELPERS =====================

fn generate_code() -> String {
    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..6).map(|_| chars[rng.gen_range(0..chars.len())] as char).collect()
}

async fn send_to_client(
    clients: &Clients,
    addr: &SocketAddr,
    msg: serde_json::Value
) {
    if let Some(tx) = clients.lock().await.get(addr) {
        let _ = tx.send(msg.to_string());
    }
}

async fn broadcast_room(room_id: &str, clients: &Clients, rooms: &Rooms) {

    let rooms_guard = rooms.lock().await;

    if let Some(room) = rooms_guard.get(room_id) {

        let state = serde_json::to_string(room).unwrap();
        let clients_guard = clients.lock().await;

        println!("📡 Broadcast sala {}", room_id);

        for p in &room.players {
            if let Some(tx) = clients_guard.get(&p.addr) {
                let _ = tx.send(state.clone());
            }
        }
    }
}

async fn send_ws_text(
    writer: &mut OwnedWriteHalf,
    message: &str
) -> Result<(), Box<dyn std::error::Error>> {

    let payload = message.as_bytes();
    let len = payload.len();

    let mut frame = vec![0x81];

    if len <= 125 {
        frame.push(len as u8);
    } else {
        frame.push(126);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    }

    frame.extend_from_slice(payload);
    writer.write_all(&frame).await?;

    Ok(())
}