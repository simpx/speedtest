'use strict';

class Peer {
    constructor(signalSend, retryOffer = true, servers = []) {
        this.signalSend = signalSend;
        this.servers = servers;
        this.peerConnection = null;
        this.makingOffer = false;
        this.ignoreOffer = false;
        this.retryOffer = retryOffer;
    }

    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.servers);
        let pc = this.peerConnection;
        pc.onconnectionstatechange = () => {
            console.log("Connection state changed to: ", pc.connectionState);
        };

        pc.oniceconnectionstatechange = () => {
            console.log("ICE connection state changed to: ", pc.iceConnectionState);
        };


        pc.onnegotiationneeded = async () => {
            try {
                console.log('触发协商需求，开始创建offer');
                this.makingOffer = true;
                await pc.setLocalDescription();
                console.log('本地描述设置完成，发送offer');
                this.signalSend({description: pc.localDescription});
            } catch (err) {
                console.log('创建offer过程中出错:', err);
            } finally {
                this.makingOffer = false;
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('发现新的ICE候选，发送给对方');
                this.signalSend({candidate: event.candidate});
            }
        };
    }

    async handleDescription(description) {
        let pc = this.peerConnection;
        try {
            const offerCollision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
            this.ignoreOffer = offerCollision && description.sdp < pc.localDescription.sdp;
            if (this.ignoreOffer) {
                console.log('offer冲突：忽略offer（本地SDP更大）');
                if (this.retryOffer) {
                    console.log('重试本地offer');
                    this.signalSend({description: pc.localDescription});
                }
                return;
            }

            if (offerCollision) {
                console.log('offer冲突：不忽略offer');
            }

            await pc.setRemoteDescription(description);
            if (description.type === 'offer') {
                await pc.setLocalDescription();
                this.signalSend({description: pc.localDescription});
            }
        } catch (err) {
            console.log('处理描述过程中出错:', err);
        }
    }

    async handleCandidate(candidate) {
        let pc = this.peerConnection;
        try {
            await pc.addIceCandidate(candidate);
        } catch (err) {
            if (!this.ignoreOffer) {
                console.log('处理候选过程中出错:', err);
                throw err;
            } else {
                console.log('忽略offer状态下，跳过ICE候选添加错误');
            }
        }
    }
    
    close() {
        let pc = this.peerConnection;
        if (pc) {
            pc.close();
            this.peerConnection = null;
        }
    }
}