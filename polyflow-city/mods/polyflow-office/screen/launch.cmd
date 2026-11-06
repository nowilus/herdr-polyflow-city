@echo off
rem PolyFlow Office screen: a second Herdr window with its own home, showing only the office.
rem Usage: launch.cmd <app home> <screen home>
setlocal
set "SRC=%~1"
set "DST=%~2"
if "%SRC%"=="" exit /b 2
if "%DST%"=="" exit /b 2
for %%d in (layouts themes mods) do if not exist "%DST%\%%d" mkdir "%DST%\%%d"
for /d %%m in ("%SRC%\mods\polyflow-*") do robocopy "%%m" "%DST%\mods\%%~nxm" /MIR /XF gpui-kit.d.ts jsconfig.json /NFL /NDL /NJH /NJS /NP >nul
copy /y "%SRC%\themes\polyflow-neon.json" "%DST%\themes\" >nul
copy /y "%SRC%\mods\polyflow-office\screen\office-screen.json" "%DST%\layouts\" >nul
if exist "%SRC%\settings.json" copy /y "%SRC%\settings.json" "%DST%\" >nul
rem The agents' hooks write their activity into the main home: tell the office window where that is.
if not exist "%DST%\data\polyflow-office" mkdir "%DST%\data\polyflow-office"
>"%DST%\data\polyflow-office\source-home.txt" echo %SRC%
set "HERDR_APP_HOME=%DST%"
start "" herdr-app
for /l %%i in (1,1,20) do (
  herdr-app do layout.switch --name office-screen >nul 2>&1 && goto switched
  ping -n 2 127.0.0.1 >nul
)
exit /b 1
:switched
herdr-app do overlay.close >nul 2>&1
exit /b 0
