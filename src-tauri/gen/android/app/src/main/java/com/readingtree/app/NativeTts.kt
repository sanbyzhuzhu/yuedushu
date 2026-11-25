package com.readingtree.app

import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * 阅读树 · Android 原生 TTS 桥（V0.3.3）
 *
 * 背景：Android WebView 不提供 Web Speech API 的 speechSynthesis（前端朗读在手机上无反应），
 * 这里用系统 TextToSpeech 兜底，通过 addJavascriptInterface 暴露给前端：
 *   window.ReadingTreeNativeTts.isReady() / hasChinese() / getVoices() / setVoice(id)
 *   / speak(text, id, rate) / stop()
 * 朗读结束或出错时经 evaluateJavascript 回调 window.__rtTtsNativeEvent(type, id)，
 * 前端据此推进段落队列。
 *
 * 注意：Android TextToSpeech 没有 pause/resume，暂停由前端「记住段落 + 重读该段」实现。
 */
@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class NativeTts(private val webView: WebView) {

  private val main = Handler(Looper.getMainLooper())

  @Volatile
  private var ready = false

  @Volatile
  private var langOk = false

  @Volatile
  private var engineName = ""

  private var tts: TextToSpeech? = null

  init {
    tts = TextToSpeech(webView.context) { status -> handleInit(status) }
  }

  private fun handleInit(status: Int) {
    val engine = tts ?: return
    if (status != TextToSpeech.SUCCESS) {
      ready = false
      notifyJs("ready", "0")
      return
    }
    langOk = try {
      val r = engine.setLanguage(Locale.SIMPLIFIED_CHINESE)
      r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
    } catch (e: Exception) {
      false
    }
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {}

      override fun onDone(utteranceId: String?) {
        notifyJs("done", utteranceId)
      }

      override fun onError(utteranceId: String?) {
        notifyJs("error", utteranceId)
      }

      override fun onError(utteranceId: String?, errorCode: Int) {
        notifyJs("error", utteranceId)
      }
    })
    engineName = try {
      engine.defaultEngine ?: ""
    } catch (e: Exception) {
      ""
    }
    ready = true
    notifyJs("ready", "1")
  }

  private fun isZh(locale: Locale): Boolean {
    val l = locale.language
    return l == "zh" || l == "cmn" || l == "zho"
  }

  /** 音色的友好中文名：中文（中国） · 本地 */
  private fun label(v: Voice): String {
    val loc = v.locale
    val sb = StringBuilder(if (isZh(loc)) "中文" else loc.displayLanguage.ifEmpty { loc.language })
    if (loc.displayCountry.isNotEmpty()) sb.append("（").append(loc.displayCountry).append("）")
    sb.append(if (v.isNetworkConnectionRequired) " · 在线" else " · 本地")
    return sb.toString()
  }

  private fun notifyJs(type: String, id: String?) {
    val safe = (id ?: "").replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
    webView.post {
      try {
        webView.evaluateJavascript(
          "window.__rtTtsNativeEvent&&window.__rtTtsNativeEvent('$type','$safe')",
          null
        )
      } catch (e: Exception) {
        /* webview 已销毁 */
      }
    }
  }

  // ---------- 暴露给前端的方法（名不可改，proguard 已 keep） ----------

  @JavascriptInterface
  fun isReady(): Boolean = ready

  @JavascriptInterface
  fun hasChinese(): Boolean = langOk

  @JavascriptInterface
  fun getEngineName(): String = engineName

  /** 返回 [{id,name,lang}]，中文音色排前 */
  @JavascriptInterface
  fun getVoices(): String {
    val engine = tts ?: return "[]"
    return try {
      val vs = engine.voices
      if (vs.isNullOrEmpty()) return "[]"
      val sorted = vs.sortedWith(compareBy({ if (isZh(it.locale)) 0 else 1 }, { it.name }))
      val arr = JSONArray()
      for (v in sorted) {
        arr.put(JSONObject().apply {
          put("id", v.name)
          put("name", label(v))
          put("lang", v.locale.toLanguageTag())
        })
      }
      arr.toString()
    } catch (e: Exception) {
      "[]"
    }
  }

  @JavascriptInterface
  fun setVoice(id: String): Boolean {
    val engine = tts ?: return false
    return try {
      val v = engine.voices?.firstOrNull { it.name == id } ?: return false
      engine.voice = v
      true
    } catch (e: Exception) {
      false
    }
  }

  @JavascriptInterface
  fun speak(text: String, id: String, rate: Float) {
    val engine = tts
    if (engine == null) {
      notifyJs("error", id)
      return
    }
    main.post {
      try {
        engine.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
        val r = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        if (r != TextToSpeech.SUCCESS) notifyJs("error", id)
      } catch (e: Exception) {
        notifyJs("error", id)
      }
    }
  }

  @JavascriptInterface
  fun stop() {
    main.post {
      try {
        tts?.stop()
      } catch (e: Exception) {
        /* ignore */
      }
    }
  }

  /** 由 Activity 在销毁时调用，释放引擎 */
  fun shutdown() {
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (e: Exception) {
      /* ignore */
    }
    tts = null
    ready = false
  }
}
