@echo off
chcp 65001 >nul
title 物流跟踪助手 - 一键部署

setlocal enabledelayedexpansion

echo ========================================
echo   物流跟踪助手 - 一键部署脚本
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请先安装 Node.js https://nodejs.org
    pause
    exit /b 1
)

:: 检查/安装 CloudBase CLI
where tcb >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/4] 正在安装 CloudBase CLI...
    call npm install -g @cloudbase/cli
) else (
    echo [1/4] CloudBase CLI 已安装
)

:: 登录
echo [2/4] 请在打开的浏览器中扫码登录...
echo       用你注册小程序的微信扫码
call tcb login

:: 切换到项目目录
cd /d "%~dp0"

:: 部署
echo [3/4] 正在部署云函数（含环境变量和定时触发器）...
echo.
echo 部署 api-gateway...
call tcb functions deploy api-gateway --force

echo 部署 tracking-worker...
call tcb functions deploy tracking-worker --force

echo 部署 engine-controller...
call tcb functions deploy engine-controller --force

echo 部署 notification-sender...
call tcb functions deploy notification-sender --force

:: 设置环境变量
echo.
echo [4/4] 正在设置环境变量...
echo.
call tcb fn env set api-gateway KUAIDI100_KEY UEPLKXkF9092
call tcb fn env set api-gateway KUAIDI100_CUSTOMER 07D4624843A9E1EAFBE8C49504ACE65F

call tcb fn env set tracking-worker KUAIDI100_KEY UEPLKXkF9092
call tcb fn env set tracking-worker KUAIDI100_CUSTOMER 07D4624843A9E1EAFBE8C49504ACE65F

call tcb fn env set engine-controller KUAIDI100_KEY UEPLKXkF9092
call tcb fn env set engine-controller KUAIDI100_CUSTOMER 07D4624843A9E1EAFBE8C49504ACE65F
call tcb fn env set engine-controller PLATFORMS pdd

call tcb fn env set notification-sender KUAIDI100_KEY UEPLKXkF9092
call tcb fn env set notification-sender KUAIDI100_CUSTOMER 07D4624843A9E1EAFBE8C49504ACE65F

echo.
echo ========================================
echo   云函数部署完成！
echo ========================================
echo.
echo 接下来:
echo   1. 打开微信开发者工具
echo   2. 项目目录指向: miniprogram\miniprogram
echo   3. AppID 填: wx19349197c537e97e
echo   4. 即可预览和使用小程序
echo.
echo 注意: Playwright 引擎（云托管）需单独在
echo CloudBase 控制台创建，后续再配
echo.
pause
