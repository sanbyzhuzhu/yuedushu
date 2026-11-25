package com.readingtree.app

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.Executors

/** Copy granted content URIs immediately; JS pulls bounded chunks after its library is ready. */
class NativeImportBridge(private val activity: MainActivity) {
  private val worker = Executors.newSingleThreadExecutor()
  private val pending = ArrayList<JSONObject>()
  private val files = HashMap<String, File>()
  @Volatile private var closed = false
  private val directory = File(activity.cacheDir, "incoming-books").apply { mkdirs() }

  init {
    directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 24L * 60 * 60 * 1000 }?.forEach { it.delete() }
  }

  @Suppress("DEPRECATION")
  internal fun accept(intent: Intent?) {
    if (intent == null || intent.action !in listOf(Intent.ACTION_VIEW, Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
    val uris = LinkedHashSet<Uri>()
    if (intent.action == Intent.ACTION_VIEW) intent.data?.let { uris.add(it) }
    if (intent.action == Intent.ACTION_SEND) (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let { uris.add(it) }
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
    intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) } }
    for (uri in uris) {
      worker.execute {
        val id = UUID.randomUUID().toString()
        var name = "外部书籍"
        val target = File(directory, id)
        try {
          require(uri.scheme == "content" || uri.scheme == "file") { "仅支持本地书籍文件" }
          name = uri.lastPathSegment?.substringAfterLast('/') ?: name
          if (uri.scheme == "content") activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) name = it.getString(0) ?: name
          }
          name = name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(200)
          val mime = activity.contentResolver.getType(uri) ?: intent.type
          val extension = when (mime) {
            "application/epub+zip" -> ".epub"
            "application/pdf" -> ".pdf"
            "text/plain" -> ".txt"
            "text/markdown", "text/x-markdown" -> ".md"
            "application/x-mobipocket-ebook" -> ".mobi"
            "application/vnd.amazon.ebook" -> ".azw"
            "application/x-fictionbook+xml", "application/fb2+xml" -> ".fb2"
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" -> ".docx"
            "application/vnd.oasis.opendocument.text" -> ".odt"
            "text/html" -> ".html"
            "application/xhtml+xml" -> ".xhtml"
            "application/x-cbz", "application/vnd.comicbook+zip" -> ".cbz"
            else -> ""
          }
          val supported = Regex("(?i).*\\.(epub|pdf|txt|md|markdown|mobi|azw3?|prc|fb2|zip|cbz|docx|odt|ofd|updb|html|htm|xhtml)$")
          if (!supported.matches(name) && extension.isNotEmpty()) name += extension
          require(supported.matches(name)) { "不支持的书籍格式，请选择 EPUB、TXT、PDF 等电子书" }
          val input = activity.contentResolver.openInputStream(uri) ?: error("无法读取书籍，请重新授权")
          input.use { source -> target.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            var size = 0L
            while (true) {
              check(!closed) { "接收已取消，请重新打开书籍" }
              val count = source.read(buffer)
              if (count < 0) break
              size += count
              require(size <= 256L * 1024 * 1024) { "书籍超过 256 MiB" }
              output.write(buffer, 0, count)
            }
          } }
          synchronized(this) {
            if (closed) { target.delete(); return@execute }
            files[id] = target
            pending.add(JSONObject().put("id", id).put("name", name).put("size", target.length()).put("open", uris.size == 1))
          }
        } catch (error: Exception) {
          target.delete()
          synchronized(this) { if (!closed) pending.add(JSONObject().put("id", id).put("name", name).put("size", 0).put("error", error.message ?: "无法接收书籍")) }
        }
      }
    }
  }

  @JavascriptInterface
  @Synchronized
  fun take(): String {
    val result = JSONArray()
    pending.forEach { result.put(it) }
    pending.clear()
    return result.toString()
  }

  @JavascriptInterface
  @Synchronized
  fun readChunk(id: String, offset: Long): String {
    val file = files[id] ?: return ""
    if (offset < 0 || offset >= file.length()) return ""
    return RandomAccessFile(file, "r").use {
      it.seek(offset)
      val bytes = ByteArray(minOf(256L * 1024, file.length() - offset).toInt())
      it.readFully(bytes)
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
  }

  @JavascriptInterface
  @Synchronized
  fun release(id: String) { files.remove(id)?.delete() }

  internal fun close() {
    closed = true
    worker.shutdownNow()
    synchronized(this) { files.values.forEach { it.delete() }; files.clear(); pending.clear() }
  }
}
