# The NPU detector's native library (libnpu.so). Rockchip's RKNN header is not in the repository (its licence
# doesn't clearly allow redistributing it): tools/npu/fetch_rknn.sh puts it in third_party/rknn/ and the runtime
# in src/main/jniLibs/. Without them the library still builds, and reports that it has no NPU runtime.
cmake_minimum_required(VERSION 3.22.1)
project(npu CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(npu SHARED npu_jni.cpp npu_post.cpp)
target_compile_options(npu PRIVATE -O3 -Wall -Wextra -fvisibility=hidden)
target_link_libraries(npu log dl)
# 16 KB pages (Android 15+ devices may use them)
target_link_options(npu PRIVATE "-Wl,-z,max-page-size=16384")

set(RKNN_DIR ${CMAKE_CURRENT_LIST_DIR}/third_party/rknn)
# re-run this configure step when the header appears or goes (its folders' times change), not only on a clean build
foreach(dir ${CMAKE_CURRENT_LIST_DIR} ${CMAKE_CURRENT_LIST_DIR}/third_party ${RKNN_DIR})
  if(EXISTS ${dir})
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${dir})
  endif()
endforeach()
if(EXISTS ${RKNN_DIR}/rknn_api.h)
  message(STATUS "npu: RKNN header found, NPU support on")
  target_include_directories(npu PRIVATE ${RKNN_DIR})
  target_compile_definitions(npu PRIVATE NPU_HAVE_RKNN=1)
else()
  message(STATUS "npu: no RKNN header (run tools/npu/fetch_rknn.sh), NPU support compiled out")
  target_compile_definitions(npu PRIVATE NPU_HAVE_RKNN=0)
endif()
