@echo off
chcp 936 >nul 2>&1
title Face Studio 启动器
set "PROJ=C:\Users\95575\WorkBuddy\面部看脸\face-studio"

cd /d "%PROJ%" 2>nul
if errorlevel 1 (
  echo [错误] 找不到项目目录：%PROJ%
  echo 请确认项目是否移动过位置。
  pause
  exit /b 1
)

:MENU
cls
echo ============================================
echo              Face Studio  启动器
echo ============================================
echo   项目路径：%PROJ%
echo --------------------------------------------
echo   [1] 启动开发服务器并打开浏览器   默认
echo   [2] 生产构建  输出到 dist
echo   [3] 运行单元测试
echo   [4] 安装 / 重新安装依赖
echo   [5] 打开项目文件夹
echo   [0] 退出
echo ============================================
set "CH=1"
set /p "CH=请输入序号后回车（直接回车=1）: "
if "%CH%"=="1" goto START
if "%CH%"=="2" goto BUILD
if "%CH%"=="3" goto TEST
if "%CH%"=="4" goto INSTALL
if "%CH%"=="5" goto OPEN
if "%CH%"=="0" goto END
goto MENU

:START
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo 检测到 5173 端口已在运行，直接打开浏览器。
  start "" http://localhost:5173
  pause
  goto MENU
)
if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
)
echo.
echo 正在启动开发服务器：http://localhost:5173
echo 浏览器会在几秒后自动打开。关闭本窗口即可停止服务。
echo.
start "" /min cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:5173"
call npm run dev
echo.
echo 服务已停止。
pause
goto MENU

:BUILD
echo 正在生产构建...
call npm run build
echo.
echo 构建完成，输出在 dist 目录。
pause
goto MENU

:TEST
echo 正在运行单元测试...
call npm test
pause
goto MENU

:INSTALL
echo 正在安装依赖...
call npm install
pause
goto MENU

:OPEN
start "" "%PROJ%"
goto MENU

:END
exit /b 0
