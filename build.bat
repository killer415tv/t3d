@echo off
echo Building T3D Library...
cd library
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo Error building library
    exit /b %errorlevel%
)
cd ..

echo.
echo Building T3D Explorer...
cd explorer
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo Error building explorer
    exit /b %errorlevel%
)
cd ..

echo.
echo Build completed successfully!
