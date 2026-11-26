# The NPU detector's image maths (android/app/src/main/cpp/npu_post.*) built and tested on the Mac:
#   cmake -S tools/npu/test -B build/npu-test && cmake --build build/npu-test && ctest --test-dir build/npu-test --output-on-failure
cmake_minimum_required(VERSION 3.16)
project(npu_post_test CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(SRC ${CMAKE_CURRENT_LIST_DIR}/../../../android/app/src/main/cpp)
add_executable(npu_post_test test_post.cpp ${SRC}/npu_post.cpp)
target_include_directories(npu_post_test PRIVATE ${SRC})
target_compile_options(npu_post_test PRIVATE -Wall -Wextra -O1)
enable_testing()
add_test(NAME npu_post COMMAND npu_post_test)
