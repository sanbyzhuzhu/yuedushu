package com.readingtree.app

import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

class NativeFileBridge(private val activity: MainActivity, private val webView: WebView) {
  private val worker = Executors.newSingleThreadExecutor()

  internal fun result(id: String, path: String = "", error: String = "") {
    webView.post {
      webView.evaluateJavascript("window.readingTreeFileResult?.(${JSONObject.quote(id)},${JSONObject.quote(path)},${JSONObject.quote(error)})", null)
    }
  }

  @JavascriptInterface
  fun save(id: String, filename: String, mime: String, base64: String) {
    worker.execute {
      try {
        val name = filename.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").take(180).ifBlank { "阅读树导出.txt" }
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (Build.VERSION.SDK_INT < 29) {
          activity.runOnUiThread { activity.chooseExportFile(id, name, mime, bytes, this) }
          return@execute
        }
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, name)
          put(MediaStore.Downloads.MIME_TYPE, mime)
          put(MediaStore.Downloads.RELATIVE_PATH, "Download/阅读树")
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: error("无法创建导出文件")
        try {
          (resolver.openOutputStream(uri) ?: error("无法写入导出文件")).use { it.write(bytes) }
          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
          var actualName = name
          resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) actualName = it.getString(0)
          }
          result(id, "已保存到 Download/阅读树/$actualName")
        } catch (error: Exception) {
          resolver.delete(uri, null, null)
          throw error
        }
      } catch (error: Exception) { result(id, error = "导出失败：${error.message ?: "请检查存储空间"}") }
    }
  }

  internal fun writeSelected(id: String, uri: android.net.Uri, bytes: ByteArray) {
    worker.execute {
      try {
        (activity.contentResolver.openOutputStream(uri) ?: error("无法写入文件")).use { it.write(bytes) }
        result(id, "已保存到所选位置")
      } catch (error: Exception) { result(id, error = "导出失败：${error.message}") }
    }
  }
}
