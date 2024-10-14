'use strict';

let socket;
let peerConnection;
let dataChannel; // ordered
let unorderedDataChannel;

const signalServer = document.querySelector('input#signalServer');
const logArea = document.querySelector('textarea#logArea');
const intervalToPing = document.querySelector('input#intervalToPing');
const mbToSend = document.querySelector('input#mbToSend');
const bandwidthProgress = document.querySelector('progress#bandwidthProgress');

const connectButton = document.querySelector('button#connectButton');
const disconnectButton = document.querySelector('button#disconnectButton');

const startPingButton = document.querySelector('button#startPingButton');
const stopPingButton = document.querySelector('button#stopPingButton');

const startBandwidthButton = document.querySelector('button#startBandwidthButton');
const stopBandwidthButton = document.querySelector('button#stopBandwidthButton');

const clearButton = document.querySelector('button#clearButton');

// 自定义日志函数
function customLog(...args) {
    const timestamp = new Date().toISOString();
    // 将所有参数转换为字符串并连接
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
    logArea.value += `${timestamp}: ${message}\n`;
    logArea.scrollTop = logArea.scrollHeight; // 自动滚动到最新日志
}

// 清空日志的函数
clearButton.addEventListener('click', () => {
    logArea.value = ''; // 清空textarea
});

// connect to signal server
connectButton.onclick = connectSignalServer;
disconnectButton.onclick = clearAll;

let makingOffer = false;
let ignoreOffer = false;

async function connectSignalServer() {
    const url = signalServer.value;
    socket = new WebSocket(url);
    socket.onopen = async () => {
        customLog("[signal server] connected");
    }
    socket.onclose = () => {
        customLog("[signal server] disconnected");
    }
    socket.onerror = (error) => {
        customLog("[signal server] error: ", error);
    }
    socket.onmessage = async (event) => {
        let message;
        if (typeof event.data === 'string') {
            message = JSON.parse(event.data);
        } else if (event.data instanceof Blob) { // TODO why?
            message = JSON.parse(await event.data.text());
        }
        customLog("[signal server] recv: ", message);
        if (message.type === 'server') {
            if (message.clientCount === 1 || message.clientCount === 2) {
                customLog(`客户端数量: ${message.clientCount}，开始创建对等连接`);
                createPeerConnection();
                connectButton.textContent = '等待对等连接';
                connectButton.disabled = true;
                disconnectButton.disabled = false;

                customLog('创建数据通道');
                dataChannel = peerConnection.createDataChannel('ordered', { ordered: true });
                unorderedDataChannel = peerConnection.createDataChannel('unordered', { ordered: false, maxRetransmits: 0 });
                setupDataChannel();

                peerConnection.onnegotiationneeded = async () => {
                    try {
                        customLog('触发协商需求，开始创建offer');
                        makingOffer = true;
                        await peerConnection.setLocalDescription();
                        customLog('本地描述设置完成，发送offer');
                        socket.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
                    } catch (err) {
                        customLog('创建offer过程中出错:', err);
                    } finally {
                        makingOffer = false;
                    }
                };

                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        customLog('发现新的ICE候选，发送给对方');
                        socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
                    }
                };
            } else {
                customLog("[signal server] something wrong: ", message);
                socket.close()
            }
        } else if (message.type === 'offer') {
            customLog('收到offer');
            const offerCollision = makingOffer || peerConnection.signalingState !== 'stable';
            ignoreOffer = offerCollision && message.offer.sdp < peerConnection.localDescription.sdp;
            
            if (ignoreOffer) {
                customLog('检测到offer冲突，忽略接收到的offer');
                return;
            }

            customLog('设置远程描述（offer）');
            await peerConnection.setRemoteDescription(message.offer);
            customLog('创建并设置本地描述（answer）');
            await peerConnection.setLocalDescription();
            customLog('发送answer');
            socket.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
        } else if (message.type === 'answer') {
            customLog('收到answer，设置远程描述');
            await peerConnection.setRemoteDescription(message.answer);
        } else if (message.type === 'candidate') {
            customLog('收到新的ICE候选');
            try {
                await peerConnection.addIceCandidate(message.candidate);
                customLog('成功添加ICE候选');
            } catch (err) {
                if (!ignoreOffer) {
                    customLog('添加ICE候选失败:', err);
                    throw err;
                } else {
                    customLog('忽略offer状态下，跳过ICE候选添加错误');
                }
            }
        } else if (message.type === 'ice-candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    }
}

function clearAll() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
        console.log('close peerConnection.');
    }
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
        console.log('close dataChannel.');
    }
    if (unorderedDataChannel) {
        unorderedDataChannel.close();
        unorderedDataChannel = null;
        console.log('close unorderedDataChannel.');
    }
    if (socket) {
        socket.close()
        socket = null;
    }
    connectButton.textContent = 'Connect';
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    startPingButton.disabled = true;
    stopPingButton.disabled = false;
}

// peerconnection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection();
    let conn = peerConnection;
    peerConnection.onconnectionstatechange = () => {
        // TODO 为什么close()不能导致这里的状态变化？
        console.log("Connection state changed to: ", conn.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE connection state changed to: ", conn.iceConnectionState);
    };
};

function setupDataChannel() {
    if (dataChannel) {
        dataChannel.onopen = () => {
            connectButton.textContent = 'Connected';
            connectButton.disabled = true;
            disconnectButton.disabled = false;
            startPingButton.disabled = false;
            stopPingButton.disabled = true;
            startBandwidthButton.disabled = false;
            stopBandwidthButton.disabled = true;
            customLog('dataChannel is opened');
            socket.close();
        }
        dataChannel.onclose = () => {
            connectButton.textContent = 'Connect';
            connectButton.disabled = false;
            disconnectButton.disabled = true;
            startPingButton.disabled = true;
            stopPingButton.disabled = false;
            startBandwidthButton.disabled = true;
            stopBandwidthButton.disabled = false;
            customLog('dataChannel is closed');
            if (unorderedDataChannel) unorderedDataChannel.close();
        }
    }
    if (unorderedDataChannel) {
        unorderedDataChannel.onopen = () => {
            customLog('unorderedDataChannel is opened');
        }
        unorderedDataChannel.onclose = () => {
            customLog('unorderedDataChannel is closed');
        }
        unorderedDataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'ping') {
                customLog("ping recv: ", message.id);
                unorderedDataChannel.send(JSON.stringify({type: 'pong', id: message.id}));
            }
        }
    }
}

// ping

let stopFlag = false;
function sendAndWait(channel, message, timeout) {
    const originHandle = channel.onmesssage;
    return new Promise((resolve, reject) => {
        let isResolved = false; // 标识是否已解析
        // 设置超时处理
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                channel.onmessage = originHandle; // 恢复消息处理器
                reject(new Error(`Timeout waiting for response`));
            }
        }, timeout);
        // 定义回应的处理函数
        const handleResponse = (event) => {
            isResolved = true;
            clearTimeout(timeoutId);
            resolve(event);
        };
        channel.onmessage = handleResponse;
        channel.send(message);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

startPingButton.onclick = async () => {
    startPingButton.disabled = true;
    stopPingButton.disabled = false;
    stopFlag = false;
    let idx = 1;
    let latencies = []; // Reset latencies
    let pingCount = 0; // Reset ping count
    const intervalMs = intervalToPing.value;
    while (!stopFlag) {
        const startTime = performance.now();
        try {
            const event = await sendAndWait(unorderedDataChannel,
                JSON.stringify({type: 'ping', id: idx}), intervalMs);
            const message = JSON.parse(event.data); // 解析事件数据
            const endTime = performance.now();
            const latency = endTime - startTime; // 计算延迟
            
            latencies.push(latency); // 存储延迟
            pingCount++; // 计算成功 ping 次数

            customLog("ping ok: ", message.id, "Latency:", latency.toFixed(2) + " ms");
        } catch (error) {
            if (error.message === "Timeout waiting for response") {
                customLog("ping timeout: ", idx);
                console.error("Timed out: No response received within the allotted time.");
            } else {
                customLog("ping fail: ", idx);
                console.error("Error:", error.message);
            }
        }
        idx ++;
        await sleep(intervalMs);
    }
    if (latencies.length > 0) {
        const minLatency = Math.min(...latencies);
        const maxLatency = Math.max(...latencies);
        const avgLatency = latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length;
        const lostPackets = idx - 1 - pingCount; // 丢包率计算
        const packetLossRate = (lostPackets / (idx - 1)) * 100; // 

        customLog("Ping Statistics:");
        customLog("Minimum Latency: ", minLatency.toFixed(2) + " ms");
        customLog("Maximum Latency: ", maxLatency.toFixed(2) + " ms");
        customLog("Average Latency: ", avgLatency.toFixed(2) + " ms");
        customLog("Packet Loss Rate: ", packetLossRate.toFixed(2) + "%" );
    } else {
        customLog("No successful pings.");
    }
    startPingButton.disabled = false;
    stopPingButton.disabled = true;
}

stopPingButton.onclick = () => {
    stopFlag = true;
}

const MAX_CHUNK_SIZE = 262144;
let chunkSize;
let dataString;
let lowWaterMark;
let highWaterMark;
let bytesToSend;
let timeoutHandle = null;
let sendStartTime;

// bandwidth test
startBandwidthButton.onclick = () => {
    chunkSize = Math.min(peerConnection.sctp.maxMessageSize, MAX_CHUNK_SIZE);
    console.log('Determined chunk size: ', chunkSize);
    dataString = new Array(chunkSize).fill('X').join('');
    lowWaterMark = chunkSize; // A single chunk
    highWaterMark = Math.max(chunkSize * 16, 1048576); // 8 chunks or at least 1 MiB
    console.log('Send buffer low water threshold: ', lowWaterMark);
    console.log('Send buffer high water threshold: ', highWaterMark);
    dataChannel.bufferedAmountLowThreshold = lowWaterMark;
    dataChannel.addEventListener('bufferedamountlow', (e) => {
      // console.log('BufferedAmountLow event:', e);
      sendData();
    });

    bytesToSend = mbToSend.value * 1024 * 1024; // 32MBytes

    customLog("Start bandwidth test.")
    bandwidthProgress.max = bytesToSend;
    bandwidthProgress.value = 0;
    sendStartTime = performance.now();
    sendData();
}

function sendData() {
    // Stop scheduled timer if any (part of the workaround introduced below)
    if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    }

    let bufferedAmount = dataChannel.bufferedAmount;
    while (bandwidthProgress.value < bandwidthProgress.max) {
        dataChannel.send(dataString);
        bufferedAmount += chunkSize;
        bandwidthProgress.value += chunkSize;

        if (bandwidthProgress.value === bandwidthProgress.max) {
            customLog('Data transfer completed successfully!');
            const spentTime = performance.now() - sendStartTime;
            customLog('Total time spent: ' + spentTime);
            customLog('MBytes/Sec: ' + (bytesToSend / 1000) / spentTime);
            break;
        }

        // Pause sending if we reach the high water mark
        if (bufferedAmount >= highWaterMark) {
            // This is a workaround due to the bug that all browsers are incorrectly calculating the
            // amount of buffered data. Therefore, the 'bufferedamountlow' event would not fire.
            if (dataChannel.bufferedAmount < lowWaterMark) {
                timeoutHandle = setTimeout(() => sendData(), 0);
            }
            // console.log(`Paused sending, buffered amount: ${bufferedAmount} (announced: ${dataChannel.bufferedAmount})`);
            break;
        }
    }

}
