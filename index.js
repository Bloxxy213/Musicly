const {Client, Intents, Guild} = require("discord.js")
const {generateDependencyReport, joinVoiceChannel, createAudioPlayer, createAudioResource} = require("@discordjs/voice")
const fs = require('fs');
const ytdlCore = require('ytdl-core');
const youtubeSearch = require('youtube-search');
const express = require("express")
const Commands = new Map()
var queue = []

require('dotenv').config()

var opts = {
  maxResults: 10,
  key: process.env.YoutubeKey,
  safeSearch: "none",
  type: "video",
  videoDimension: "2d",
};

const streamOptions = { seek: 0, volume: 1 };
var regExp = /^https?\:\/\/(?:www\.youtube(?:\-nocookie)?\.com\/|m\.youtube\.com\/|youtube\.com\/)?(?:ytscreeningroom\?vi?=|youtu\.be\/|vi?\/|user\/.+\/u\/\w{1,2}\/|embed\/|watch\?(?:.*\&)?vi?=|\&vi?=|\?(?:.*\&)?vi?=)([^#\&\?\n\/<>"']*)/i;

const client = new Client({ intents: [Intents.FLAGS.GUILDS,Intents.FLAGS.GUILD_MESSAGES,Intents.FLAGS.GUILD_VOICE_STATES,
Intents.FLAGS.GUILD_MESSAGE_REACTIONS]});
const server = express()

console.log(generateDependencyReport());

function matchYoutubeUrl(url){
  var match = url.match(regExp);
  return (match && match[1].length==11)? match[1] : false;
}

function convertHMS(value) {
  const sec = parseInt(value, 10);
  let hours   = Math.floor(sec / 3600);
  let minutes = Math.floor((sec - (hours * 3600)) / 60);
  let seconds = sec - (hours * 3600) - (minutes * 60);

  if (hours   < 10) {hours   = "0"+hours;}
  if (minutes < 10) {minutes = "0"+minutes;}
  if (seconds < 10) {seconds = "0"+seconds;}
  return hours+':'+minutes+':'+seconds;
}

async function PlaySong(message,Link,guildQueue) {
  if(!guildQueue) return 

  const info = await ytdlCore.getInfo(Link)
  const thumbnailsSize = info.videoDetails.thumbnails.length - 1

  message.channel.send({content: "Playing " + info.videoDetails.title + " with a duration of " + convertHMS(info.videoDetails.lengthSeconds) + " seconds.",files: [info.videoDetails.thumbnails[thumbnailsSize].url]})

  const stream = ytdlCore(Link, { filter: 'audioonly',highWaterMark: 1<<25,"quality": "highestaudio"});
  
  const resource = createAudioResource(stream);
  guildQueue.player.play(resource, streamOptions);
}


async function vote(message,guildQueue,Args) {
  var VoteNum = Args[0]
  VoteNum = parseInt(VoteNum,10)

  if(!VoteNum) return message.reply({content:"You need to incldue a number."})
  if(VoteNum>10) return message.reply({content:"Number must be in 1-5 range."})
  if(VoteNum<1) return message.reply({content:"Number must be in 1-5 range."})
  if(!guildQueue) return message.reply({content:"The bot needs to join a channel first."})
  if(!guildQueue.VoteMembers) return message.reply({content:"The bot needs to join a channel first."})
  if(guildQueue.VoteMembers.length < 3) return message.reply({content:"First you have to call ;play."})
  
  const song = guildQueue.VoteMembers[VoteNum]
  guildQueue.songs.push(song.link)

  if (guildQueue.songs.length == 1){
    PlaySong(message,song.link,guildQueue)
  } else {
    message.reply("Your selected song is now #" + guildQueue.songs.length + " in our queue.")
  }

  return guildQueue.VoteMembers.splice(0,guildQueue.VoteMembers.length)
}

const GetLinkResults = async (array1) => {
  const NewArray = []

  for (const result of array1) {
    NewArray.push(result.link)
  }

  return NewArray
}

const AsyncFunc = async (guildQueue,array,message) => {
  const allAsyncResults = []
  const LinkResults = await GetLinkResults(array)

  message.reply({content:"Type " + process.env.Key + "vote {num} to play a song."})
  for (const result of array) {
    const ARR = await ytdlCore.getInfo(result.link).then((info) => {
      const num = LinkResults.indexOf(result.link) + 1
      const thumbnailsSize = info.videoDetails.thumbnails.length - 1
      message.channel.send({content:"Choice #" + num.toString() + " " + info.videoDetails.title + " with a duration of " + convertHMS(info.videoDetails.lengthSeconds),files: [info.videoDetails.thumbnails[thumbnailsSize].url]})
      guildQueue.VoteMembers[num] = result
    }, (reason) => {
      message.channel.send({content: reason})
    });
    allAsyncResults.push(ARR)
  }

  return allAsyncResults
}

async function play(message,guildQueue,Args) {
  if(!Args[0]) return message.reply({content:"You have to provide a link or a name."})

  if(!guildQueue) return message.reply({content:"The bot isn't in a voice channel"})
  if(!guildQueue.songs) return message.reply({content:"The bot isn't in a voice channel"})

  const isYoutubeUrl = matchYoutubeUrl(Args[0])

  if (isYoutubeUrl){
    guildQueue.songs.push(Args[0])
    if (guildQueue.songs.length == 1){
      PlaySong(message,Args[0],guildQueue)
    }
  } else {
    var msg = message.content.split(" ")
    msg.shift()
    msg = msg.join(" ")

    youtubeSearch(msg,opts,function(err,results){
      if (err) return console.log(err)
      AsyncFunc(guildQueue,results,message)
    })
  }
} 

async function HandleEnding(message,guildQueue,player){
  player.on('stateChange', (oldState, newState) => {
    if (oldState.status == "playing") {
      if (newState.status == "idle") {
          if (guildQueue.repeatMode == "none") {
            guildQueue.songs.shift()
          }
          if (guildQueue.songs[0]){
            PlaySong(message,guildQueue.songs[0],guildQueue)
          }
      }
    }
  })
}

async function join(message,guildQueue,Args) {
  const userVoice = message.member.voice.channel
  const guildId = message.guild.id.toString()

  if(!userVoice) return message.reply({content:"You have to be in a voice channel for the bot to join."})

  queue[guildId] = []
  queue[guildId].VoteMembers = []
  queue[guildId].voiceChannelRaw = userVoice
  queue[guildId].songs = []
  queue[guildId].repeatMode = "none"

  const connection = joinVoiceChannel({
    channelId: userVoice.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
  })

  queue[guildId].voiceChannel = connection
  queue[guildId].player = createAudioPlayer()
  connection.subscribe(queue[guildId].player)
  HandleEnding(message,queue[guildId],queue[guildId].player)
}

async function skip(message,guildQueue,Args){
  if(!guildQueue) return message.reply({content:"The bot isn't in a voice channel."})
  if(!guildQueue.songs) return message.reply({content:"The bot isn't in a voice channel."})
  if(guildQueue.songs.length < 2) return message.reply({content:"There should be at least one music in the queue and one playing."})

  guildQueue.songs.shift()
  PlaySong(message,guildQueue.songs[0],guildQueue)
}

async function repeat(message,guildQueue,Args){
  if(!guildQueue) return message.reply({content:"The bot isn't in a voice channel."})

  const repeatMode = guildQueue.repeatMode

  if(!repeatMode) return message.reply({content:"The bot isn't in a voice channel."})

  if(repeatMode=="none"){
    guildQueue.repeatMode = "repeat"
  } else {
    guildQueue.repeatMode = "none"
  }
}

async function leave(message,guildQueue,Args){
  if(!guildQueue) return message.reply({content:"The bot isn't in a voice channel."})

  const Voice = guildQueue.voiceChannel

  if(!Voice) return message.reply({content:"The bot isn't in a voice channel."})

  guildQueue.voiceChannel.destroy();

  guildQueue.splice(0,guildQueue.length)
}

Commands.set("leave",leave)
Commands.set("join",join)
Commands.set("play",play)
Commands.set("vote",vote)
Commands.set("skip",skip)
Commands.set("repeat",repeat)

client.on("messageCreate", message => {
    if (message.author.bot) return
    if (!message.content.startsWith(process.env.Key)) return
    var msg = message.content.substr(1)
    var Args = message.content.split(" ")
    const Command = Commands.get(msg.split(" ")[0].toLowerCase())

    Args.shift()
    
    if (Command) return Command(message,queue[message.guild.id.toString()],Args)

    message.reply({content:"Invalid command."})
})

process.on("unhandledRejection", console.log);
client.login(process.env.TOKEN)

server.all("/", (req, res) => {
  fs.readFile("./webPanel.html", 'utf8', (error, data) => {
    if(error){
      console.log(error)
      return res.send(error)
    }
    return res.send(data)
  });
})

server.listen(9871)
