@echo off
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=25564"

rem WebRTC TURN defaults for the local coturn setup.
rem Override these before running start.bat if your host or secret differs.
if "%TURN_HOST%"=="" set "TURN_HOST=[IP/DOMAIN]"
if "%TURN_ALT_HOSTS%"=="" set "TURN_ALT_HOSTS="
if "%TURN_REALM%"=="" set "TURN_REALM=%TURN_HOST%"
if "%TURN_PORT%"=="" set "TURN_PORT=25510"
if "%TURN_TLS_PORT%"=="" set "TURN_TLS_PORT=25511"
if "%TURN_RELAY_MIN_PORT%"=="" set "TURN_RELAY_MIN_PORT=30000"
if "%TURN_RELAY_MAX_PORT%"=="" set "TURN_RELAY_MAX_PORT=30030"
if "%TURN_TTL_SECONDS%"=="" set "TURN_TTL_SECONDS=3600"
if "%TURN_RELAY_ONLY%"=="" set "TURN_RELAY_ONLY=true"
if "%TURN_ENABLE_STUN%"=="" set "TURN_ENABLE_STUN=false"
if "%TURN_ENABLE_TCP%"=="" set "TURN_ENABLE_TCP=true"
if "%TURN_SECRET%"=="" set "TURN_SECRET="

echo Starting SSC...
echo App: https://%TURN_HOST%:%PORT%
echo TURN: %TURN_HOST%:%TURN_PORT%, alternates %TURN_ALT_HOSTS%, relay ports %TURN_RELAY_MIN_PORT%-%TURN_RELAY_MAX_PORT%
echo TURN modes: relay-only=%TURN_RELAY_ONLY%, stun=%TURN_ENABLE_STUN%, tcp=%TURN_ENABLE_TCP%
node server.js
pause
