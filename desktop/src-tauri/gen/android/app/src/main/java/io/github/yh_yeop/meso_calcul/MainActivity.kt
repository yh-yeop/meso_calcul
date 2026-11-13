package io.github.yh_yeop.meso_calcul

import android.app.Activity
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // 첫 페이지를 불러오기 전에 불린다 → 웹(store.js applyTheme)이 시작할 때 window.MesoNative 가 있다
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(MesoNative(this), "MesoNative")
  }
}

/** 웹에서 부르는 네이티브 기능. JavascriptInterface 메서드는 WebView 의 백그라운드 스레드에서 불린다. */
private class MesoNative(private val activity: Activity) {
  /**
   * 상태 표시줄 · 내비게이션 바 아이콘 색을 앱 테마에 맞춘다.
   * enableEdgeToEdge() 는 시스템 다크 여부로만 정해서, 앱 테마를 시스템과 반대로 두면 아이콘이 안 보인다.
   * light=true 면 밝은 화면용(어두운 아이콘).
   */
  @JavascriptInterface
  fun setLightStatusBar(light: Boolean) {
    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      controller.isAppearanceLightStatusBars = light
      controller.isAppearanceLightNavigationBars = light
    }
  }
}
