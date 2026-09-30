@echo off
chcp 65001 >nul
title 数独 Sudoku Studio
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动.ps1"
if errorlevel 1 pause
