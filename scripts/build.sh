#!/bin/bash

# 安装依赖
npm install

# 将 SVG 转换为 PNG（需要安装 ImageMagick）
mkdir -p assets
convert assets/icon.svg assets/icon.png

# 编译 TypeScript
npm run build

# 打包应用
npm run package 