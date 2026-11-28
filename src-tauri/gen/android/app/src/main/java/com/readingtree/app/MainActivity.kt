package com.readingtree.app

import android.os.Bundle
import android.app.Activity
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContracts
import android.view.ActionMode
import android.webkit.WebView
import android.webkit.JavascriptInterface
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override val handleBackNavigation: Boolean = false
  private var nativeTts: NativeTts? = null
  private var menuBridge: NativeMenuBridge? = null
  private var curActionMode: ActionMode? = null
  private var readingWebView: WebView? = null
  private var scanId: String? = null
  private val libraryScanner = registerForActivityResult(ScanContract()) { result ->
    val id = scanId
    scanId = null
    if (id != null) sendScanResult(id, result.contents ?: "", if (result.contents == null) "已取消扫码或未授予相机权限" else "")
  }

  private fun sendScanResult(id: String, text: String, error: String) {
    readingWebView?.evaluateJavascript("window.readingTreeScanResult?.(${JSONObject.quote(id)},${JSONObject.quote(text)},${JSONObject.quote(error)})", null)
  }

  inner class LibraryScannerBridge {
    @JavascriptInterface
    fun scan(id: String) {
      runOnUiThread {
        if (scanId != null) { sendScanResult(id, "", "请先完成当前扫码"); return@runOnUiThread }
        scanId = id
        try {
          libraryScanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("扫描 Olib / OPDS 书库二维码").setBeepEnabled(false).setOrientationLocked(false))
        } catch (error: Exception) { scanId = null; sendScanResult(id, "", "无法打开扫码相机，请使用二维码图片导入") }
      }
    }
  }
  private var backPending = false
  private val nativeImports by lazy { NativeImportBridge(this) }
  private data class ExportRequest(val id: String, val bytes: ByteArray, val bridge: NativeFileBridge)
  private var exportRequest: ExportRequest? = null
  private val exportPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { response ->
    val request = exportRequest
    exportRequest = null
    if (request != null) {
      val uri = response.data?.data
      if (response.resultCode == Activity.RESULT_OK && uri != null) request.bridge.writeSelected(request.id, uri, request.bytes)
      else request.bridge.result(request.id, error = "已取消导出")
    }
  }

  internal fun chooseExportFile(id: String, name: String, mime: String, bytes: ByteArray, bridge: NativeFileBridge) {
    if (exportRequest != null) { bridge.result(id, error = "请先完成当前导出"); return }
    exportRequest = ExportRequest(id, bytes, bridge)
    try {
      exportPicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mime
        putExtra(Intent.EXTRA_TITLE, name)
      })
    } catch (error: Exception) {
      exportRequest = null
      bridge.result(id, error = "无法打开保存窗口")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    nativeImports.accept(intent)
    setIntent(Intent(Intent.ACTION_MAIN))
    // The native dispatcher must consult the reader even when WebView has no history.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (backPending) return
        val view = readingWebView ?: return
        backPending = true
        view.evaluateJavascript("window.readingTreeBack ? window.readingTreeBack() : 'handled'") { result ->
          backPending = false
          if (result == "\"exit\"") finish()
        }
      }
    })
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    nativeImports.accept(intent)
    setIntent(Intent(Intent.ACTION_MAIN))
  }

  /**
   * V0.3.6：去掉系统长按自带的「复制 / 全选 / 共享 / 网页搜索」浮动菜单。
   * 阅读场景用不到这些，而它弹出后会压住我们自己的划线弹层。
   *
   * 注意只能清空菜单项，决不能 mode.finish() —— 那会连带把文本选区一起取消，
   * 划线就划不成了。选区本身仍由系统维护，只是不再显示那条工具条。
   */
  internal fun stripNativeActionMenu() {
    val m = curActionMode ?: return
    runCatching { m.menu.clear() }
  }

  override fun onActionModeStarted(mode: ActionMode?) {
    curActionMode = mode
    // 部分 ROM 在 super() 里会用默认菜单填充，故前后各清一次
    stripNativeActionMenu()
    super.onActionModeStarted(mode)
    stripNativeActionMenu()
  }

  override fun onActionModeFinished(mode: ActionMode?) {
    if (curActionMode === mode) curActionMode = null
    super.onActionModeFinished(mode)
  }

  /**
   * V0.3.3：Android WebView 不提供 Web Speech API 的语音合成，朗读功能在手机上无反应，
   * 这里把系统 TextToSpeech 桥注入到 WebView（window.ReadingTreeNativeTts）。
   * onWebViewCreate 由 WryActivity.setWebView 调用，早于页面加载，注入时机安全。
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    readingWebView = webView
    webView.addJavascriptInterface(LibraryScannerBridge(), "ReadingTreeNativeScanner")
    webView.addJavascriptInterface(nativeImports, "ReadingTreeNativeImports")
    webView.addJavascriptInterface(NativeFileBridge(this, webView), "ReadingTreeNativeFiles")
    webView.addJavascriptInterface(NativeHttpBridge(webView), "ReadingTreeNativeHttp")
    webView.addJavascriptInterface(NativeUpdateBridge(this), "ReadingTreeNativeUpdate")
    nativeTts = NativeTts(webView).also {
      webView.addJavascriptInterface(it, "ReadingTreeNativeTts")
    }
    menuBridge = NativeMenuBridge(this).also {
      webView.addJavascriptInterface(it, "ReadingTreeNativeMenu")
    }
  }

  override fun onDestroy() {
    nativeImports.close()
    nativeTts?.shutdown()
    nativeTts = null
    menuBridge = null
    readingWebView = null
    super.onDestroy()
  }
}
