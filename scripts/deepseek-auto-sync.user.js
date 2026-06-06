// ==UserScript==
// @name         DeepSeek Auto Cookie Sync
// @namespace    deepseek-balance-monitor
// @version      1.0
// @description  自动将 platform.deepseek.com 的认证信息发送到 VS Code 插件
// @author       DeepSeek Monitor
// @match        https://platform.deepseek.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    var PLUGIN_URL = 'http://127.0.0.1:9877/auth';
    var SENT_KEY = '__ds_auto_sync_sent__';
    var DEBOUNCE_MS = 30000; // 30s 内不重复发送

    function sendAuth(token, cookie) {
        var now = Date.now();
        var lastSent = parseInt(localStorage.getItem(SENT_KEY) || '0', 10);
        if (now - lastSent < DEBOUNCE_MS) {
            console.log('[DS-AutoSync] 跳过（30 秒内已发送）');
            return;
        }
        localStorage.setItem(SENT_KEY, String(now));

        console.log('[DS-AutoSync] 发送认证信息到 VS Code 插件...');
        fetch(PLUGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, cookie: cookie })
        }).then(function(r) {
            return r.json();
        }).then(function(data) {
            if (data.ok) {
                console.log('[DS-AutoSync] ✅ VS Code 插件已接收');
            }
        }).catch(function(e) {
            console.log('[DS-AutoSync] ⚠ 发送失败（插件未运行？）:', e.message);
        });
    }

    // 方法 1：拦截 fetch — 捕获每次 API 请求的 Authorization header
    var origFetch = window.fetch;
    window.fetch = function(url, options) {
        var headers = (options && options.headers) || {};
        var auth = headers['Authorization'] || headers['authorization'] || '';
        var cookie = document.cookie || '';

        if (auth && cookie) {
            // 异步发送，不阻塞原始请求
            setTimeout(function() { sendAuth(auth, cookie); }, 100);
        }

        return origFetch.apply(this, arguments);
    };

    // 方法 2：拦截 XMLHttpRequest — 捕获 XHR 请求的 header
    var origXHROpen = XMLHttpRequest.prototype.open;
    var origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__ds_url = url;
        this.__ds_headers = {};
        return origXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        this.__ds_headers = this.__ds_headers || {};
        this.__ds_headers[name.toLowerCase()] = value;
        return origXHRSetHeader.apply(this, arguments);
    };

    // 监听 XHR load 事件来捕获
    var origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        var self = this;
        var auth = (self.__ds_headers && self.__ds_headers['authorization']) || '';
        var cookie = document.cookie || '';

        if (auth && cookie) {
            self.addEventListener('load', function() {
                setTimeout(function() { sendAuth(auth, cookie); }, 100);
            });
        }

        return origXHRSend.apply(this, arguments);
    };

    // 方法 3：页面加载后 2 秒兜底发送（从 localStorage 读取）
    setTimeout(function() {
        var token = '';
        var keys = ['userToken','token','auth','authToken','access_token','accessToken'];
        for (var i = 0; i < keys.length; i++) {
            var val = localStorage[keys[i]];
            if (val && val.length > 10) {
                // DeepSeek 用 {value: "..."} JSON 格式
                try { var p = JSON.parse(val); token = p.value || val; } catch(e) { token = val; }
                break;
            }
        }
        var cookie = document.cookie || '';
        if (token || cookie) {
            sendAuth(token, cookie);
        }
    }, 2000);

    console.log('[DS-AutoSync] 已激活 — 认证信息将自动同步到 VS Code');
})();
