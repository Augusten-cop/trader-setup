const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const speakeasy = require('speakeasy');
const { getHeaders } = require('./utils/headers');

// Function to login and fetch NSE symbols
async function updateSmartAPIData() {
  try {
    // Generate TOTP
    const generatedTOTP = speakeasy.totp({
      secret: process.env.SMARTAPI_TOTP_SECRET,
      encoding: 'base32'
    });

    // Login payload
    const loginData = JSON.stringify({
      clientcode: process.env.SMARTAPI_CLIENTID,
      password: process.env.SMARTAPI_PASSWORD,
      totp: generatedTOTP,
      state: "Assinco"
    });

    // Login config
    const loginConfig = {
      method: 'post',
      url: 'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword',
      headers: await getHeaders(),
      data: loginData
    };

    // Login
    const loginResponse = await axios(loginConfig);
    if (!loginResponse.data.status) {
      console.error('Login failed:', loginResponse.data);
      return;
    }

    const jwtToken = loginResponse.data.data.jwtToken;
    fs.writeFileSync('data/jwtToken.json', JSON.stringify({ jwtToken }, null, 2));
    console.log('JWT token saved.');

    // Fetch NSE symbols
    const scripResponse = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
    const scripData = scripResponse.data;

    const nseEquitySymbols = scripData.filter(item => item.exch_seg === 'NSE' && item.symbol.endsWith('-EQ'));
    fs.writeFileSync('data/nseEquitySymbols.json', JSON.stringify(nseEquitySymbols, null, 2));
    console.log('NSE equity symbols saved.');

  } catch (error) {
    console.error('Error:', error.message || error);
  }
}

module.exports = {
    updateSmartAPIData
};
