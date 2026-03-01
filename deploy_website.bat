@echo off
echo ===================================================
echo   GGU AI - GitHub Pages Installer Deployment
echo ===================================================

:: Ensure website directory exists
if not exist website (
    echo [ERROR] website directory not found!
    exit /b 1
)

:: Get remote orgin url from main repo
for /f "delims=" %%i in ('git config --get remote.origin.url') do set ORIGIN_URL=%%i
if "%ORIGIN_URL%"=="" (
    echo [ERROR] No git remote 'origin' found in main repo! Cannot deploy to gh-pages.
    exit /b 1
)

:: Copy latest installer builds to website directory
echo.
echo [1/3] Copying built EXEs to website directory...
copy /Y "electron-app\dist\RIFT CI-CD Healing Agent Setup 1.0.0.exe" "website\GGU_AI_CI_CD_Healing_Agent_Setup_1.0.0.exe"
copy /Y "electron-app\dist\RIFT CI-CD Healing Agent 1.0.0.exe" "website\GGU_AI_CI_CD_Healing_Agent_1.0.0.exe"

echo.
echo [2/3] Setting up Git repository for gh-pages...
cd website

:: Remove any existing git repo in the website folder to ensure a clean push
if exist .git (
    rmdir /S /Q .git
)

:: Initialize a fresh repo
git init
git checkout -b gh-pages

:: Add remote
git remote add origin %ORIGIN_URL%

:: Add and commit all files
git add .
git commit -m "Auto-deploy website with latest installers"

echo.
echo [3/3] Forcing push to GitHub gh-pages branch...
:: Push to the parent's origin, forcing the gh-pages branch update
git push -f origin gh-pages

cd ..

echo.
echo ===================================================
echo   DEPLOYMENT COMPLETE!
echo   Your download site should be live on your GitHub Pages URL shortly.
echo ===================================================
