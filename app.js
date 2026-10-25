function helpMsg() {
    document.getElementById("htext").innerText="I have yet to write something meaningful here"
    document.getElementById("help").style.display = "flex";
    document.getElementById("close").focus();
}
function closeBox() {
    document.getElementById("help").style.display = "none";
    document.getElementById("scanBtn").focus();
}
function scanPress() {
    navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            width: 240,
            height:320,
        },
    }).then((stream) => display(stream))


}
function display(stream) {
    const vidEl = document.getElementById("videoElement")
    vidEl.srcObject = stream
    document.getElementById("cameravideo").style.display = "flex"
    document.getElementById("triggerScan").focus()
    document.getElementById("triggerScan").addEventListener("click", scanCode)
}
function scanCode() {
    const vidEl = document.getElementById("videoElement")
    const canvas = document.createElement("canvas")
    canvas.width = vidEl.videoWidth;
    canvas.height = vidEl.videoHeight;
    const ctx = canvas.getContext("2d")
    ctx.drawImage(vidEl, 0, 0, vidEl.videoWidth, vidEl.videoHeight)
    const imgData = ctx.getImageData(0, 0, vidEl.videoWidth, vidEl.videoHeight)
    const data = jsQR(imgData.data, vidEl.videoWidth, vidEl.videoHeight)
    /*  const dUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.download = 'data.png';
    downloadLink.href = dUrl;
    downloadLink.click();   */
    //alert(data)
    //alert(data.data)
    console.log(data)
    if (data === null) {
        alert('No QR data found')
    }
    if (typeof data.data === 'string') {
        const isUrl = URL.canParse(data.data);
        window.AppsManagement.installPackage(data.data)
    }
    if (data.data === null) {
        notify("Failed to scan, no manifest found")
    }
}

function notify(message) {
    // will make this work better in future, currently just going to be an alert
    alert(message)
}
