module.exports = [
  {
    id: 'agnes',
    enabled: true,
    priority: 100,
    capabilities: [
      'text-to-image',
      'image-to-image',
      'text-to-video',
      'image-to-video',
      'keyframes-to-video'
    ],
    capability_limits: {
      'text-to-image': {
        minWidth: 256,
        maxWidth: 2048,
        minHeight: 256,
        maxHeight: 2048,
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4']
      },
      'image-to-image': {
        minWidth: 256,
        maxWidth: 2048,
        minHeight: 256,
        maxHeight: 2048,
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        requiresImageInput: true
      },
      'text-to-video': {
        maxSingleSegmentDuration: 18,
        maxFrames: 441,
        defaultFrameRate: 24,
        minFrameRate: 1,
        maxFrameRate: 60,
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        frameCountRule: '8n+1'
      },
      'image-to-video': {
        maxSingleSegmentDuration: 18,
        maxFrames: 441,
        defaultFrameRate: 24,
        minFrameRate: 1,
        maxFrameRate: 60,
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        frameCountRule: '8n+1',
        requiresImageInput: true
      },
      'keyframes-to-video': {
        maxSingleSegmentDuration: 18,
        maxFrames: 441,
        defaultFrameRate: 24,
        minFrameRate: 1,
        maxFrameRate: 60,
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        frameCountRule: '8n+1',
        requiresImageInputs: 2
      }
    },
    provider: require('./agnes/provider.cjs')
  }
];
