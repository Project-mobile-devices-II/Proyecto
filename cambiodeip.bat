@echo off
echo ================================================
echo  DADO TRIPLE - Configuración Port Proxy WSL
echo ================================================

:: Obtener la IP actual de WSL automáticamente
for /f "tokens=*" %%i in ('wsl hostname -I') do set WSL_IP=%%i
set WSL_IP=%WSL_IP:~0,15%   :: toma solo la primera IP

echo IP de WSL detectada: %WSL_IP%

:: Borrar regla anterior (por si existe)
netsh interface portproxy delete v4tov4 listenport=5000 listenaddress=0.0.0.0 >nul 2>&1

:: Crear la nueva regla
netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=%WSL_IP%

echo.
echo ✅ Regla de puerto 5000 configurada correctamente!
echo Ahora puedes conectar desde celulares usando la IP WiFi de tu laptop.
echo.
pause