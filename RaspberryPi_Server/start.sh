#!/bin/bash

# 라즈베리파이용 스마트 수면 알람 서버 실행 스크립트

echo "🍓 라즈베리파이 스마트 수면 알람 서버를 시작합니다..."

# Node.js가 설치되어 있는지 확인
if ! command -v node &> /dev/null; then
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "다음 명령으로 Node.js를 설치하세요:"
    echo "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "sudo apt-get install -y nodejs"
    exit 1
fi

# npm이 설치되어 있는지 확인
if ! command -v npm &> /dev/null; then
    echo "❌ npm이 설치되어 있지 않습니다."
    echo "Node.js 설치를 다시 확인해주세요."
    exit 1
fi

echo "✅ Node.js 버전: $(node --version)"
echo "✅ npm 버전: $(npm --version)"

# 의존성 설치
echo "📦 의존성을 설치합니다..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 의존성 설치에 실패했습니다."
    exit 1
fi

# 라즈베리파이 IP 주소 표시
echo "🌐 라즈베리파이 IP 주소:"
hostname -I | awk '{print $1}'

# 서버 시작
echo "🚀 서버를 시작합니다..."
echo "웹 인터페이스: http://[라즈베리파이IP]:8080"
echo "종료하려면 Ctrl+C를 누르세요."

node server.js
