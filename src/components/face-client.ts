"use client";

type FaceApi = typeof import("@vladmandic/face-api");

export class FaceScanError extends Error {}

let faceApiPromise: Promise<FaceApi> | null = null;

async function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = import("@vladmandic/face-api")
      .then(async (faceApi) => {
        await Promise.all([
          faceApi.nets.tinyFaceDetector.loadFromUri("/face-models"),
          faceApi.nets.faceLandmark68Net.loadFromUri("/face-models"),
          faceApi.nets.faceRecognitionNet.loadFromUri("/face-models"),
        ]);
        return faceApi;
      })
      .catch((error: unknown) => {
        faceApiPromise = null;
        throw error;
      });
  }
  return faceApiPromise;
}

function eyeAspectRatio(points: Array<{ x: number; y: number }>) {
  const distance = (first: number, second: number) =>
    Math.hypot(
      points[first].x - points[second].x,
      points[first].y - points[second].y,
    );
  return (
    (distance(1, 5) + distance(2, 4)) /
    (2 * Math.max(distance(0, 3), 0.001))
  );
}

function averageEyeAspectRatio(
  left: Array<{ x: number; y: number }>,
  right: Array<{ x: number; y: number }>,
) {
  return (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function getFaceDescriptor(
  video: HTMLVideoElement,
  requireBlink: boolean,
) {
  const faceApi = await loadFaceApi();
  const options = new faceApi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.6,
  });
  let sawOpenEyes = false;
  let sawBlink = false;
  for (let attempt = 0; attempt < (requireBlink ? 36 : 1); attempt += 1) {
    const detection = await faceApi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (detection) {
      if (!requireBlink)
        return Array.from(detection.descriptor);
      const ratio = averageEyeAspectRatio(
        detection.landmarks.getLeftEye(),
        detection.landmarks.getRightEye(),
      );
      if (ratio > 0.22) sawOpenEyes = true;
      if (sawOpenEyes && ratio < 0.17) sawBlink = true;
      if (sawBlink && ratio > 0.22)
        return Array.from(detection.descriptor);
    }
    if (requireBlink) await wait(200);
  }
  throw new FaceScanError(
    requireBlink
      ? "Face not found or blink not detected. Look at the camera and blink once."
      : "Face not found. Center your face in the camera and try again.",
  );
}

export async function startFaceCamera(video: HTMLVideoElement) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("This browser does not support camera access.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopFaceCamera(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
