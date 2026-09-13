/**
 * SkeletonOverlay component.
 * 
 * Draws pose skeleton and angles on top of video using canvas.
 */
import { useEffect, useRef } from 'react';

function SkeletonOverlay({ videoRef, currentFrame, csvData }) {
  const canvasRef = useRef(null);

  // Skeleton connections (pairs of landmark names to draw lines between)
  const SKELETON_CONNECTIONS = [
    // Torso
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    // Left arm
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    // Right arm
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    // Left leg
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['left_ankle', 'left_heel'],
    // Right leg
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
    ['right_ankle', 'right_heel'],
  ];

  // Angles to display
  const DISPLAY_ANGLES = [
    'left_elbow',
    'right_elbow',
    'left_knee',
    'right_knee',
    'left_shoulder',
    'right_shoulder',
  ];

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !csvData) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');

    // Match canvas size to video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get frame data
    const frameData = csvData[currentFrame];
    if (!frameData) return;

    // Extract landmarks
    const landmarks = extractLandmarks(frameData);

    // Draw skeleton
    drawSkeleton(ctx, landmarks);

    // Draw angles
    drawAngles(ctx, frameData);

  }, [currentFrame, csvData, videoRef]);

  const extractLandmarks = (frameData) => {
    const landmarks = {};
    
    // Parse landmark columns (e.g., landmark_left_shoulder_x)
    for (const [key, value] of Object.entries(frameData)) {
      if (key.startsWith('landmark_') && !key.endsWith('_visibility')) {
        const parts = key.split('_');
        const axis = parts[parts.length - 1]; // x, y, or z
        const landmarkName = parts.slice(1, -1).join('_'); // e.g., 'left_shoulder'

        if (!landmarks[landmarkName]) {
          landmarks[landmarkName] = {};
        }

        if (value !== '' && value !== null && value !== undefined) {
          landmarks[landmarkName][axis] = parseFloat(value);
        }
      }
    }

    return landmarks;
  };

  const drawSkeleton = (ctx, landmarks) => {
    // Draw connections
    ctx.strokeStyle = '#00FF00'; // Green
    ctx.lineWidth = 2;

    for (const [pointA, pointB] of SKELETON_CONNECTIONS) {
      const a = landmarks[pointA];
      const b = landmarks[pointB];

      if (a && b && a.x && a.y && b.x && b.y) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Draw joint circles
    ctx.fillStyle = '#FFFF00'; // Yellow
    for (const [name, coords] of Object.entries(landmarks)) {
      if (coords.x && coords.y) {
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  };

  const drawAngles = (ctx, frameData) => {
    ctx.fillStyle = '#FFFFFF'; // White
    ctx.font = '14px Arial';

    let yPos = 60;
    const xPos = 10;

    for (const angleName of DISPLAY_ANGLES) {
      const angleKey = `angle_${angleName}`;
      const angleValue = frameData[angleKey];

      if (angleValue !== '' && angleValue !== null && angleValue !== undefined) {
        const angleDeg = parseFloat(angleValue);
        const text = `${angleName.replace(/_/g, ' ')}: ${angleDeg.toFixed(1)}°`;
        
        // Background for text
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(xPos - 5, yPos - 16, 200, 20);
        
        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(text, xPos, yPos);
        
        yPos += 25;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

export default SkeletonOverlay;
