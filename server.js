//@author Alan-Liang

var http=require("http");
var fs=require("fs");
var log=require("npmlog");
var timeH=require("./timeH");
var mime=require("mime");
var url=require("url");
var vurl=require("./vurl");
var utils=require("./utils");
var ws=require("ws");
var deepcopy=require("deepcopy");

var endl="\r\n";

//consts
var VOWELS="a,e,i,o,u,ai,ao,au,ea,ei,eu,oa,oe,ou,ua,uo".split(",");
var CONSOS="q,w,r,t,y,p,s,d,f,g,h,j,k,l,z,x,c,v,b,n,m,zh,ch,sh,ph".split(",");
var ALICE=1;
var BOB=2;
var EVE=3;
var MAXTRIES=3;
var CHANCE_LOST=0.2;
var CHANCE_MISS=0.1;
var WORDLENGTH=5;
var CHAT_REGEXP=/^[a-z]*$/; //must be lowercase letters

var listeningFunc=function(req,resp){
  // Parse the request containing file name
  var pathname = url.parse(req.url).pathname.substr(1);
  if(vurl.query(pathname)){
    try{
      (vurl.query(pathname))(req,resp);
      return;
    }catch(e){
      log.error(timeH(),"Error executing "+pathname+" : "+e.stack);
      resp.writeHead(501, {'Content-Type':'text/plain'});
      resp.write("HTTP 501");
      resp.end();
      return;
    }
  }else if(cache[pathname]){
    var type=mime.lookup(pathname.substr(1));
    resp.writeHead(200, {'Content-Type':type});
    resp.write(cache[pathname]);
    resp.end();
    return;
  }else{
    resp.writeHead(404,{'Content-Type':'text/plain'});
    resp.write("HTTP 404");
    resp.end();
    return;
  }
};

var pendReq=function(req){
    var params = url.parse(req.url,true).query;
  if(storage[params["room"]]!==undefined){
    return storage[params["room"]];
  }
  return false;
}

function lottery(chance) {
  var rnd=Math.random();
  return rnd<chance;
}

var storage={};
var originStorage={"pwds":{},"playerCount":0,"history":[],wscs:[]};
storage.testRoom=deepcopy(originStorage);

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

function randWord(){
  var word="";
  var vowelFirst=lottery(0.5);
  for(var i=0;i<WORDLENGTH;i++){
    var vowel=shuffle(VOWELS.concat())[0];
    var conso=shuffle(CONSOS.concat())[0];
    if(vowelFirst){
      word+=(vowel+conso);
    }else{
      word+=(conso+vowel);
    }
  }
  return word;
}

function randomize(ws,str){
  //TODO
  function randLetter() {
    var letters="qwertyuiopasdfghjklzxcvbnm".split("");
    return shuffle(letters)[0];
  }
  var encoded="";
  for(var i=0;i<str.length;i++){
    if(lottery(CHANCE_LOST)){}
    else if(lottery(CHANCE_MISS)){
      encoded+=randLetter();
    }else{
      encoded+=str[i];
    }
  }
  return encoded;
}

function broadcast(wscs,text1,text2){
  for(var i=1;i<wscs.length;i++){
    sendMsg(wscs[i],i,text1,text2);
  }
}

function sendMsg(ws,uid,text1,text2){
  var text=encodeURIComponent(text1)+" "+encodeURIComponent(text2);
  try{
    ws.send("CHAT "+text+endl);
  }catch(e){
    log.warn(timeH(),"Send chat error on "+uid);
  }
  ws._store.history[uid]=text;
}

var wsl=function(ws,req){
  ws._store=pendReq(req);
  if(!ws._store){
    ws.send("LOGERR 401 Invalid&nbsp;room!"+endl);
    ws.close(1000,"normal");
    return;
  }
  ws.addEventListener('close'),function(){
    if(ws._store) ws._store.wscs[ws._uid]=undefined;
  }
  ws._dataPile="";
  ws.addEventListener('message',function(msg){
    ws._dataPile+=msg.data;
    var cmds=ws._dataPile.split(endl);
    if(cmds.length>1){
      for(var i=0;i<cmds.length-1;i++){
        log.info(timeH(), "Command Recv: ",cmds,i);
        var args=cmds[i].split(" ");
        switch(args[0]){
          case "LOGIN":
          if(!args[1]){
            ws.send("LOGERR 400 No&nbsp;password&nbsp;provided!"+endl);
          }else if(ws._store.pwds[args[1]]){
            ws._uid=ws._store.pwds[args[1]];
            ws.send("LOGOK "+ws._store.pwds[args[1]]+endl);
            ws.send("CHAT "+ws._store.history[ws._uid]+endl);
            ws._store.wscs[ws._uid]=ws;
          }else if((!args[2])&&(ws._store.playerCount!=3)){
            ws._store.playerCount++;
            ws._store.pwds[args[1]]=ws._store.playerCount;
            ws.send("LOGOK "+ws._store.playerCount+endl);
            ws._uid=ws._store.playerCount;
            ws._store.wscs[ws._uid]=ws;
            if(ws._store.playerCount==3){
              //TODO
              var wscs=ws._store.wscs;
              var word=randWord();
              var wrong=randWord();
              sendMsg(wscs[ALICE],ALICE,"Welcome! You are Alice.",
                "Your word is: "+word);
              sendMsg(wscs[EVE],EVE,"Welcome! You are Eve.",
                "Your word is: "+wrong);
              sendMsg(wscs[BOB],BOB,"Welcome! You are Bob.","");
              ws._store.word=word;
              ws._store.wrong=wrong;
            }
          }else{
            ws.send("LOGERR 401 Credentials&nbsp;error!"+endl);
          }
          break;

          case "CHAT":
          if(!args[1])break;
          if(!CHAT_REGEXP.test(args[1]))break;
          if(ws._uid==ALICE){
            var text=randomize(ws,args[1]);
            if(ws._store.eveWorking)break;
            ws._store.eveWorking=[BOB,text];
            sendMsg(ws._store.wscs[EVE],EVE,"Message arrives from Alice!",text);
          }else if(ws._uid==BOB){
            var text=randomize(ws,args[1]);
            if(ws._store.eveWorking)break;
            ws._store.eveWorking=[ALICE,text];
            sendMsg(ws._store.wscs[EVE],EVE,"Message arrives from Bob!",text);
          }else if(ws._uid==EVE){
            if(!ws._store.eveWorking)break;
            var to=ws._store.eveWorking[0];
            var texts=shuffle([randomize(ws,args[1]),ws._store.eveWorking[1]]);
            //log.info(timeH(),texts);
            sendMsg(ws._store.wscs[to],to,texts[0],texts[1]);
            ws._store.eveWorking=false;
          }
          break;

          case "GUESS":
          if(ws._uid!=BOB)break;
          if(!args[1])break;
          if(!CHAT_REGEXP.test(args[1]))break;
          if(ws._store.guessesLeft===undefined){
            ws._store.guessesLeft=MAXTRIES;
          }
          if(args[1]==ws._store.word){
            broadcast(ws._store.wscs,"Alice&Bob Wins!","Congrats!");
          }else if (args[1]==ws._store.wrong) {
            broadcast(ws._store.wscs,"Eve Wins!","Congrats!");
          }else if (ws._store.guessesLeft==1) {
            broadcast(ws._store.wscs,"Computer Wins.","(again.)");
          }else{
            ws.send("CHAT Guess&nbsp;incorrect. "+(ws._store.guessesLeft-1)+"chances&nbsp;Left."+endl);
            ws._store.guessesLeft--;
          }
          break;

          case "ERROR":
          break;
          default:
          ws.send("ERROR 400"+endl);
          break;
        }
      }
      ws._dataPile=cmds[cmds.length-1];
    }
  });
};



var cache={};
var server,wss;

startsvc=function(port,ipaddress){
  if(!server){
    try{
      server=http.createServer(listeningFunc);
      ipaddress?server.listen(port,ipaddress):server.listen(port);
    }catch(e){
      log.error(timeH(),"Error listening on "+ipaddress+":"+port+": "+e.stack);
      server=undefined;
      return;
    }
    try{
      //wss=new ws.Server({port:wssport,host:ipaddress});
      wss=new ws.Server({server:server});
      wss.on("connection",wsl);
    }catch(e){
      log.error(timeH(),"Error listening wss on "+ipaddress+":"+wssport+": "+e.stack);
      server=undefined;
      return;
    }
    log.info(timeH(),"Server started, listening on "+ipaddress+":"+port+".");
  }
};

stopsvc=function(){
  if(server){
    try{
      server.close();
      wss.close();
    }catch(e){
      log.error(timeH(),"Error closing: "+e.stack);
      return;
    }
    log.info(timeH(),"Server stopped.");
    server=wss=undefined;
  }
};

var loadpages=["game.html","logo.png","mdc.css","mdc.js","styles.css","utils.js"];
for(var i=0;i<loadpages.length;i++){
  try{
    var page=fs.readFileSync(loadpages[i]);
    cache[loadpages[i]]=page;
  }catch(e){
    log.error(timeH(),"Error reading file "+loadpages[i]+" : "+e.stack);
  }
}

vurl.add({'path':'','func':function(req,resp){
  resp.writeHead(302,{Location:"/game?room=testRoom"});
  resp.end();
}});

vurl.add({'path':'game','func':function(req,resp){
  var search=url.parse(req.url).search;
  var s=utils.template(cache["game.html"].toString(),{js:"javascript",wsLocation:req.headers.host+"/ws"+search,"maxlen":8});
  resp.writeHead(200,{'Content-Type':'text/html'});
  resp.write(s);
  resp.end();
  return true;
}});

vurl.add({'path':'rs','func':function(req,resp){
  storage={};
  storage.testRoom=deepcopy(originStorage);
  resp.writeHead(200,{'Content-Type':'text/plain'});
  resp.write("OK");
  resp.end();
  return true;
}});

vurl.add({'path':'addRoom','func':function(req,resp){
  var params = url.parse(req.url,true).query;
  var s;
  if(params.room){
    if(!storage[params.room]){
      storage[params.room]=deepcopy(originStorage);
      s="OK";
    }else{
      s="Gaming please clear first";
    }
  }else{
    s="<form action=''>room=<input name='room' /><input type='submit' value='Apply' /></form>";
  }
  resp.writeHead(200,{'Content-Type':'text/html'});
  resp.write(s);
  resp.end();
  return true;
}});

var port=process.env.PORT;
if(!port){
  log.warn(timeH(),"Port not set,setting to 20080.");
  port=20080;
}

startsvc(port);
