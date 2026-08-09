import "react-native-gesture-handler";
import TrackPlayer from "react-native-track-player";

import { playbackService } from "./src/playback/service";

TrackPlayer.registerPlaybackService(() => playbackService);

import "expo-router/entry";
