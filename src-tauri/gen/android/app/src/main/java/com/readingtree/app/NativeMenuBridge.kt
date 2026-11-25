package com.readingtree.app

import android.webkit.JavascriptInterface
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * 原生系统菜单桥（V0.3.6）
 *
 * 手机长按选中文字时，Android 会弹出自带的「复制 / 全选 / 共享 / 网页搜索」浮动工具条，
 * 它会压住阅读树自己的划线弹层。MainActivity 已在 onActionModeStarted 里清空菜单项，
 * 但部分 ROM 仍可能残留一条空工具条；这里给 JS 留一个主动收掉的入口，
 * 由前端在划线弹层弹出的瞬间调用。
 */
class NativeMenuBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun openUpdateUrl(address: String): Boolean {
    val uri = Uri.parse(address)
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) return false
    activity.runOnUiThread {
      try { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
      catch (_: Exception) { Toast.makeText(activity, "未找到可打开更新地址的浏览器", Toast.LENGTH_LONG).show() }
    }
    return true
  }

  @JavascriptInterface
  fun openWebsite(site: String): Boolean {
    val url = when (site) {
      "haodoo-net" -> "https://haodoo.net/"
      "haodoo-org" -> "https://haodoo.org/"
      "standard-ebooks" -> "https://standardebooks.org/ebooks"
      "national-library" -> "https://www.nlc.cn/"
      "wikisource" -> "https://zh.wikisource.org/"
      "ctext" -> "https://ctext.org/zh"
      "github" -> "https://github.com/"
      "shuge" -> "https://shuge.org/"
      "gutenberg-australia" -> "https://gutenberg.net.au/"
      "faded-page" -> "https://www.fadedpage.com/"
      "gutenberg-canada" -> "https://www.gutenberg.ca/"
      "internet-archive" -> "https://archive.org/details/texts"
      else -> {
        val uri = Uri.parse(site)
        if (uri.scheme != "https" || uri.host !in listOf("haodoo.net", "haodoo.org", "zh.wikisource.org", "ctext.org", "github.com", "standardebooks.org", "shuge.org", "gutenberg.net.au", "www.fadedpage.com", "www.gutenberg.ca", "archive.org", "www.nlc.cn") || uri.userInfo != null || uri.port != -1) return false
        site
      }
    }
    activity.runOnUiThread {
      try { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
      catch (_: Exception) { Toast.makeText(activity, "未找到可打开网页的应用", Toast.LENGTH_LONG).show() }
    }
    return true
  }

  @JavascriptInterface
  fun hideMenu() {
    // JavascriptInterface runs on a WebView background thread. ActionMode is UI-only.
    activity.runOnUiThread { activity.stripNativeActionMenu() }
  }
}
