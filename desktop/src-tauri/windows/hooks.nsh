; 설치 훅 — 옛 이름("메소 계산기", 1.2.0 까지)으로 깔린 앱을 정리한다.
; 앱 이름(productName)이 바뀌면 설치 폴더 · 제거 항목 · 바로가기 이름이 달라져서,
; 그냥 두면 새 앱이 옛 앱 옆에 따로 깔린다. 앱 데이터(로그인 · 저장값)는
; 식별자(io.github.yh-yeop.meso-calcul) 폴더에 있어 이름과 상관없이 그대로 남는다.
; 이 파일은 UTF-8(BOM) 으로 둘 것 — 한글 이름을 레지스트리 키와 맞춰야 한다.

!define OLDPRODUCTNAME "메소 계산기"
!define OLDUNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLDPRODUCTNAME}"

Var OldNameFound
Var OldNameDesktop

!macro NSIS_HOOK_PREINSTALL
  StrCpy $OldNameFound 0
  StrCpy $OldNameDesktop 0
  ReadRegStr $R8 HKCU "${OLDUNINSTKEY}" "InstallLocation"
  ${If} $R8 != ""
    StrCpy $OldNameFound 1
    ${WordReplace} "$R8" "$\"" "" "+" $R8
    ${If} ${FileExists} "$DESKTOP\${OLDPRODUCTNAME}.lnk"
      StrCpy $OldNameDesktop 1
    ${EndIf}
    ; 옛 앱이 켜져 있으면 끈다(일반 설치는 묻고, 업데이트 · 조용한 설치는 바로)
    !insertmacro CheckIfAppIsRunning "$R8\${MAINBINARYNAME}.exe" "${OLDPRODUCTNAME}"
    ${If} ${FileExists} "$R8\uninstall.exe"
      ; /S 조용히, /UPDATE 없이 → 옛 바로가기 · 제거 항목까지 지움(앱 데이터 지우기는 꺼진 채)
      ; _?= 로 제거기가 끝날 때까지 기다린다(이때 제거기 자신은 남으므로 따로 지움)
      ExecWait '"$R8\uninstall.exe" /S _?=$R8'
      Delete "$R8\uninstall.exe"
      RMDir "$R8"
    ${Else}
      Delete "$R8\${MAINBINARYNAME}.exe"
      RMDir "$R8"
      Delete "$SMPROGRAMS\${OLDPRODUCTNAME}.lnk"
      Delete "$DESKTOP\${OLDPRODUCTNAME}.lnk"
    ${EndIf}
    DeleteRegKey HKCU "${OLDUNINSTKEY}"
    DeleteRegKey HKCU "Software\${MANUFACTURER}\${OLDPRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 업데이트 모드(/UPDATE)는 바로가기를 새로 만들지 않으므로, 옛 앱을 지웠다면 직접 만든다
  ${If} $OldNameFound = 1
  ${AndIf} $UpdateMode = 1
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${If} $OldNameDesktop = 1
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend
