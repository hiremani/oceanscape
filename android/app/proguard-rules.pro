# JSch (CommaSsh) picks its ciphers, key exchanges and signatures by class name at run time.
-keep class com.jcraft.jsch.** { *; }
# its optional integrations, absent on Android
-dontwarn com.sun.jna.**
-dontwarn org.bouncycastle.**
-dontwarn org.apache.logging.log4j.**
-dontwarn org.slf4j.**
-dontwarn org.newsclub.net.unix.**
-dontwarn com.jcraft.jzlib.**
-dontwarn javax.security.auth.**
-dontwarn org.ietf.jgss.**
# the NPU detector's JNI methods (npu_jni.cpp) are found by class and method name
-keep class ai.sunnypilot.webhud.NpuNative { native <methods>; }
