import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { VideoComposition, calculateMetadata } from './composition.jsx';
function Root(){return <Composition id="StudyLessonVideo" component={VideoComposition} width={1920} height={1080} fps={30} durationInFrames={300} defaultProps={{video:{scenes:[],fps:30,durationInFrames:300,width:1920,height:1080},audioAsset:null}} calculateMetadata={calculateMetadata}/>}
registerRoot(Root);
