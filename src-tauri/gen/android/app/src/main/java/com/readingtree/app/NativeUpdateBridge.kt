package com.readingtree.app

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest

/** User-initiated, persistent APK downloads. Only the system installer installs apps. */
class NativeUpdateBridge(private val activity: MainActivity) {
  private val prefs = activity.getSharedPreferences("app-updater", Context.MODE_PRIVATE)
  private val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
  private var verifiedId = -1L
  private fun json(status: String, message: String = "", bytes: Long = 0, total: Long = 0): String =
    JSONObject().put("status", status).put("message", message).put("bytes", bytes).put("total", total)
      .put("version", prefs.getString("version", "")).toString()
  private fun newer(a: String, b: String): Boolean {
    val left = a.split('.').map { it.toInt() }; val right = b.split('.').map { it.toInt() }
    for (i in 0..2) if (left[i] != right[i]) return left[i] > right[i]
    return false
  }
  private fun apk(): File = File(activity.cacheDir, "updates/reading-tree-${prefs.getString("version", "")}.apk")
  private fun downloaded(): File = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "reading-tree-update.apk")

  @JavascriptInterface
  @Synchronized
  fun start(address: String, version: String, sha256: String): String = try {
    val url = URL(address)
    require(url.protocol == "https" && url.userInfo == null) { "安装包需使用 HTTPS 地址" }
    require(Regex("\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}").matches(version)) { "更新版本号不正确" }
    require(Regex("[a-fA-F0-9]{64}").matches(sha256)) { "更新说明缺少 SHA-256 校验值，请使用浏览器下载" }
    val current = activity.packageManager.getPackageInfo(activity.packageName, 0)
    require(newer(version, current.versionName ?: "0.0.0")) { "只能更新到较新版本" }
    val old = prefs.getLong("id", -1)
    if (old != -1L) manager.remove(old)
    downloaded().delete(); apk().delete(); verifiedId = -1
    val request = DownloadManager.Request(Uri.parse(address))
      .setTitle("阅读树 v$version")
      .setDescription("正在下载更新，可继续阅读")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
      .setDestinationUri(Uri.fromFile(downloaded()))
    val id = manager.enqueue(request)
    prefs.edit().putLong("id", id).putString("version", version).putString("sha256", sha256.lowercase()).apply()
    json("downloading")
  } catch (e: Exception) { json("error", e.message ?: "无法开始下载") }

  @Suppress("DEPRECATION")
  private fun verify(file: File) {
    require(file.isFile && file.length() in 1..268435456L) { "安装包大小不正确" }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
    require(digest.digest().joinToString("") { "%02x".format(it) } == prefs.getString("sha256", "")) { "安装包校验失败，请重新下载" }
    val pm = activity.packageManager
    val archive = pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES) ?: error("不是有效的 APK 安装包")
    val current = pm.getPackageInfo(activity.packageName, PackageManager.GET_SIGNATURES)
    require(archive.packageName == activity.packageName && archive.versionName == prefs.getString("version", "")) { "安装包不属于此应用或版本不匹配" }
    val a = archive.signatures?.map { it.toCharsString() }?.toSet()
    val b = current.signatures?.map { it.toCharsString() }?.toSet()
    require(!a.isNullOrEmpty() && a == b) { "安装包签名与当前应用不一致" }
  }

  @JavascriptInterface
  @Synchronized
  fun status(): String = try {
    val id = prefs.getLong("id", -1)
    if (id == -1L) json("idle")
    else if (verifiedId == id && apk().isFile) json("ready", "下载完成，等待确认安装")
    else manager.query(DownloadManager.Query().setFilterById(id)).use { cursor ->
      if (!cursor.moveToFirst()) json("error", "下载记录已移除，请重新下载")
      else {
        val bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
        when (cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
          DownloadManager.STATUS_SUCCESSFUL -> {
            val file = apk(); file.parentFile?.mkdirs(); downloaded().copyTo(file, overwrite = true)
            try { verify(file); verifiedId = id; json("ready", "下载完成，等待确认安装", bytes, total) }
            catch (e: Exception) { file.delete(); throw e }
          }
          DownloadManager.STATUS_FAILED -> json("error", "下载失败，请重试或使用浏览器下载")
          else -> if (total > 268435456 || bytes > 268435456) { manager.remove(id); json("error", "安装包超过 256 MiB") }
            else json("downloading", "", bytes, total)
        }
      }
    }
  } catch (e: Exception) { json("error", e.message ?: "无法读取下载状态") }

  @JavascriptInterface
  @Synchronized
  fun cancel(): String {
    val id = prefs.getLong("id", -1)
    if (id != -1L) manager.remove(id)
    apk().delete(); downloaded().delete(); prefs.edit().clear().apply(); verifiedId = -1
    return json("idle", "已取消下载")
  }

  @JavascriptInterface
  @Synchronized
  fun install(): String = try {
    val file = apk(); verify(file)
    if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
      activity.runOnUiThread { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }
      json("ready", "请允许此应用安装更新，返回后再次点击安装")
    } else {
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
      activity.runOnUiThread {
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
      }
      json("ready", "已打开系统安装确认，请按系统提示覆盖升级")
    }
  } catch (e: Exception) { json("error", e.message ?: "无法打开安装程序") }
}
