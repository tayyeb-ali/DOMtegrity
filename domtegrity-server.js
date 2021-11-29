var fs = require('fs');
var https = require('https');
var express = require('express');
var crypto = require('crypto');
var bodyParser = require('body-parser');

var app = express();

var urlencodedParser = bodyParser.urlencoded({
    extended: false
});

var options = {
    key: fs.readFileSync('Certificates/server-key.pem'),
    cert: fs.readFileSync('Certificates/server-cert.pem'),
    ca: fs.readFileSync('Certificates/ca-cert.pem'),

    requestCert: true, // ask for a client cert
    rejectUnauthorized: false, // act on unauthorized clients at the app level
};


app.use(express.static('Client'));


var tlsSessionTokenStore = {};
var tlsSessionServerSideData = {};
var test = {};

var pageServer = https.createServer(options, app);

pageServer.listen(8080);
console.log("Listening to 8080");

var WebSocketServer = require('ws').Server
  , wss = new WebSocketServer({server: pageServer});


wss.on('connection', function(socket) {
    var sessionID = socket.upgradeReq.socket.getSession().toString('hex');


    var p1 = new Promise(

        function(resolve, reject) {
            const pKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(16);

            tlsSessionTokenStore[sessionID] = {
                "private": pKey,
                "iv": iv
            };

            tlsSessionServerSideData[sessionID] = {
                time: new Date(),
                decide: false
            }

            resolve(JSON.stringify(tlsSessionTokenStore[sessionID]));
        });
    p1.then(
        function(val) {
            socket.send(val);
        }
    )
    .catch(
        function(reason) {
            console.log("The Promise is rejected becuase of " + reason);
        }
    );

    function getDifference(str1, str2){ 
        let diff= "";
        str2.split('').forEach(function(val, i){
          if (val != str1.charAt(i))
            diff += val ;         
        });
        return diff;
      }

    function getDifference1(a, b)
    {
        var i = 0;
        var j = 0;
        var result = "";

        while (j < b.length)
        {
         if (a[i] != b[j])
             result += b[j];
         else
             i++;
         j++;
        }
        return result;
    }

    socket.on('message', function(signature) {

        const hmac = crypto.createHmac('sha256', tlsSessionTokenStore[sessionID].private);
        var pid = (fs.readFileSync("Client/index.html").toString()).replace(/["']+/g, '').replace(/[\n\r]+/g, '').replace(/\s{1,50}/g, '').trim();
        var temp = pid; //hmac.digest();0
        createMutationLogFile(signature);
        var timeNow = new Date();
        var reason = "";

        if (!tlsSessionServerSideData[sessionID].decide) {
            if (timeNow.getTime() < (tlsSessionServerSideData[sessionID].time.getTime() + 1200000)) {
                if (temp.toString("hex") == signature.toString("hex")) {
                    decision = "accept";
                } else {
                    decision = "reject";
                    reason = "The signature was inccorect!";
                }
            } else {
                decision = "reject";
                reason = "Request time bound from your browser is expired!";
            }
        } else {
            decision = "reject";
            reason = "There was another request from your browser!";
        }
        tlsSessionServerSideData[sessionID].decide = true;
        console.log(decision);
    });

    function createMutationLogFile(signature){
        var sObj = JSON.parse(signature);
        var mObj = sObj.afterLoadMutations.forEach( function(mutationList){
            mutationList.forEach(function(mutationObject){
                var xMutation = JSON.parse(mutationObject);
                console.log('======================');
                console.log(xMutation.target.outerHTML);                        
            });
        });

        console.log('======================');
        console.log(mObj);
        console.log('======================');
        console.log(sObj);
        console.log('======================');

        try {
          const writeAfter = fs.writeFileSync('./outputs/afterMutations.json', sObj.afterLoadMutations);
          const writeMObj = fs.writeFileSync('./outputs/mObj.json', mObj);
          const writeSObj = fs.writeFileSync('./outputs/sObj.json', sObj);
          console.log("Writing BEFORE to beforeMutations.json");
          console.log("Writing AFTER  to afterMutations.json");
          console.log("Writing mObj to mObj.json");
          console.log("Writing sObj to sObj.json");
        } catch (err) {
          console.error(err);
        }
    }
});