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
    score: i32,
    prediction: Option<String>,
    ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GameState {
    round: u8,
    phase: String,
    players: Vec<Player>,
    white_dice: Vec<u8>,
    submissions: HashMap<String, Vec<u8>>,
    round_scores: HashMap<String, i32>,
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
    let n = socket.read(&mut buffer).await.unwrap();
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
            };

            room.players.push(Player {
                addr: *addr,
                client_id: client_id.to_string(),
                nick: "Anon".to_string(),
                room_id: room_id.clone(),
                score: 0,
                prediction: None,
                ready: false,
            });

            rooms.lock().await.insert(room_id.clone(), room);

            send_to_client(clients, addr, serde_json::json!({
                "type": "ROOM_CREATED",
                "room_id": room_id
            })).await;
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
                            score: 0,
                            prediction: None,
                            ready: false,
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
            } // 🔓 lock se suelta aquí

            broadcast_room(&room_id, clients, rooms).await;
        }

        // ================= READY =================
        "READY" => {

            let room_id = data["room_id"].as_str().unwrap_or("").to_string();
            let client_id = data["client_id"].as_str().unwrap_or("");

            println!("✅ READY de {} en {}", client_id, room_id);

            {
                let mut rooms_lock = rooms.lock().await;

                if let Some(room) = rooms_lock.get_mut(&room_id) {
                    if let Some(p) = room.players.iter_mut().find(|p| p.client_id == client_id) {
                        p.ready = !p.ready;
                        println!("🔄 {} ready: {}", p.nick, p.ready);
                    }
                }
            } // 🔓 lock se suelta aquí

            broadcast_room(&room_id, clients, rooms).await;
        }

        _ => {}
    }
}

// ===================== HELPERS =====================

fn generate_code() -> String {
    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();

    (0..6)
        .map(|_| chars[rng.gen_range(0..chars.len())] as char)
        .collect()
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
            println!("➡️ {}", p.addr);

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