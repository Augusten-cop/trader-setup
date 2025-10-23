const os = require('os');
const axios = require('axios');

async function getSystemInfo() {
    // Get local IP
    const interfaces = os.networkInterfaces();
    const localIP = Object.values(interfaces)
        .flat()
        .find(iface => !iface.internal && iface.family === 'IPv4')?.address || '127.0.0.1';

    // Get MAC address
    const macAddress = Object.values(interfaces)
        .flat()
        .find(iface => !iface.internal && iface.family === 'IPv4')?.mac || '00-00-00-00-00-00';

    // Get public IP using a service
    let publicIP = '0.0.0.0';
    try {
        const response = await axios.get('https://api.ipify.org?format=json');
        publicIP = response.data.ip;
    } catch (error) {
        console.warn('Could not fetch public IP:', error.message);
    }

    return {
        localIP,
        publicIP,
        macAddress: macAddress.replace(/:/g, '-')
    };
}

async function getHeaders(additionalHeaders = {}) {
    const systemInfo = await getSystemInfo();
    
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': systemInfo.localIP,
        'X-ClientPublicIP': systemInfo.publicIP,
        'X-MACAddress': systemInfo.macAddress,
        'X-PrivateKey': process.env.SMARTAPI_PRIVATE_KEY || 'kODguWBV',
        ...additionalHeaders
    };
}
console.log('Headers generated:', getHeaders());
module.exports = {
    getHeaders
};

