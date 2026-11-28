package com.readingtree.app

import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Android system TLS/proxy fallback; redirects remain under the frontend's credential policy. */
class NativeHttpBridge(private val webView: WebView) {
  private val workers = Executors.newFixedThreadPool(3)
  private class Request { @Volatile var cancelled = false; @Volatile var connection: HttpURLConnection? = null }
  private val requests = ConcurrentHashMap<String, Request>()

  private fun emit(id: String, kind: String, payload: String) {
    val delivered = CountDownLatch(1)
    webView.post {
      webView.evaluateJavascript("window.readingTreeHttpEvent?.(${JSONObject.quote(id)},${JSONObject.quote(kind)},${JSONObject.quote(payload)})") { delivered.countDown() }
    }
    if (!delivered.await(15, TimeUnit.SECONDS)) error("页面未响应，请重试")
  }

  @JavascriptInterface
  fun cancel(id: String) { requests[id]?.let { it.cancelled = true; it.connection?.disconnect() } }

  @JavascriptInterface
  fun fetch(id: String, address: String, method: String, headers: String, body: String, limit: Int) {
    request(id, address, method, headers, body, limit, false)
  }

  @JavascriptInterface
  fun fetchWebdav(id: String, address: String, method: String, headers: String, body: String, limit: Int) {
    request(id, address, method, headers, body, limit, true)
  }

  private fun request(id: String, address: String, method: String, headers: String, body: String, limit: Int, webdav: Boolean) {
    val request = Request()
    requests[id] = request
    workers.execute {
      try {
        val url = URL(address)
        require((url.protocol == "https" || url.protocol == "http") && url.userInfo == null) { "不支持的地址协议或内嵌账号" }
        require(method == "GET" || method == "POST" || method == "PROPFIND") { "不支持的请求方式" }
        require(limit in 1..268435456) { "无效的文件大小限制" }
        val connection = url.openConnection() as HttpURLConnection
        request.connection = connection
        if (request.cancelled) error("已取消")
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15000
        connection.readTimeout = 15000
        connection.requestMethod = method
        val fields = JSONObject(headers)
        for (key in fields.keys()) connection.setRequestProperty(key, fields.getString(key))
        if (body.isNotEmpty()) {
          connection.doOutput = true
          connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val status = connection.responseCode
        val responseHeaders = JSONObject()
        for ((key, values) in connection.headerFields) if (key != null) responseHeaders.put(key, values.joinToString(", "))
        emit(id, "headers", JSONObject().put("status", status).put("headers", responseHeaders).toString())
        // No response body is needed for errors or manual redirects.
        if (status in 200..299 && status != 204 && status != 205) {
          if (connection.contentLengthLong > limit) error("文件超过 ${limit / 1048576} MB 限制，请下载后从本地导入")
          var total = 0L
          connection.inputStream.use { stream ->
            val bytes = ByteArray(65536)
            while (true) {
              if (request.cancelled) error("已取消")
              val count = stream.read(bytes)
              if (count < 0) break
              total += count
              if (total > limit) error("文件超过 ${limit / 1048576} MB 限制，请下载后从本地导入")
              emit(id, "chunk", Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP))
            }
          }
        }
        if (request.cancelled) error("已取消")
        emit(id, "done", "")
      } catch (error: Exception) {
        runCatching { emit(id, "error", if (request.cancelled) "已取消" else "安卓系统网络请求失败：${error.message ?: "请检查网络"}") }
      } finally { request.connection?.disconnect(); requests.remove(id) }
    }
  }
}
