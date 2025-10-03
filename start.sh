#!/bin/bash

# 스마트 수면 알람 시스템 실행 스크립트

echo "🚀 스마트 수면 알람 시스템을 시작합니다..."

# Node.js가 설치되어 있는지 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "Node.js를 설치한 후 다시 실행해주세요."
    exit 1
fi

# npm이 설치되어 있는지 확인
if ! command -v npm &> /dev/null; then
    echo "❌ npm이 설치되어 있지 않습니다."
    echo "npm을 설치한 후 다시 실행해주세요."
    exit 1
fi

# 의존성 설치
echo "📦 의존성을 설치합니다..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 의존성 설치에 실패했습니다."
    exit 1
fi

# 서버 시작
echo "🌐 서버를 시작합니다..."
echo "웹 인터페이스: http://localhost:8080"
echo "종료하려면 Ctrl+C를 누르세요."

node server.js
