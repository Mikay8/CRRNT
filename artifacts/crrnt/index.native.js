// Native entry point — registers RNTP PlaybackService before expo-router mounts.
// Metro picks this file on iOS/Android instead of index.js.
import "expo-router/entry";
import TrackPlayer from "react-native-track-player";
import { PlaybackService } from "./services/PlaybackService";

TrackPlayer.registerPlaybackService(() => PlaybackService);
