    AKN.register();
    document.getElementById("helpBtn").addEventListener("click", helpMsg)
    document.getElementById("close").addEventListener("click", closeBox)
    document.getElementById("scanBtn").addEventListener("click", scanPress)
    document.getElementById("scanBtn").focus()
    window.addEventListener('error', (event) => {
        alert(`error : ${event.message}`);
    });
