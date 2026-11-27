# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# 阅读树 V0.3.3：NativeTts 经 addJavascriptInterface 反射调用，
# release 开启了 isMinifyEnabled(R8)，必须保留类与方法名，否则朗读功能失效。
-keep class com.readingtree.app.NativeTts { *; }
# V0.3.6：同理，屏蔽系统长按菜单的桥（经 addJavascriptInterface 反射调用）
-keep class com.readingtree.app.NativeMenuBridge { *; }
-keep class com.readingtree.app.NativeImportBridge { *; }
-keep class com.readingtree.app.NativeUpdateBridge { *; }
