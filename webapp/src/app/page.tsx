"use client";

import NextImage from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE_VERSION = "0.12.10";
const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const FRAME_RATE = 30;

type GenerationStage = "idle" | "loading" | "rendering" | "ready" | "error";

export default function Home() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [overlayText, setOverlayText] = useState("با عکس من فیلم بساز");
  const [duration, setDuration] = useState(8);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<GenerationStage>("idle");
  const [statusMessage, setStatusMessage] = useState("در حال آماده‌سازی...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState("#ff7b7b");

  const imagePreview = useMemo(() => {
    if (!imageFile) {
      return null;
    }

    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  useEffect(() => {
    if (!imagePreview) {
      return () => {};
    }

    return () => {
      URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  useEffect(() => {
    if (!videoUrl) {
      return () => {};
    }

    return () => {
      URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const ensureFfmpeg = useCallback(async () => {
    if (ffmpegReady) {
      return ffmpegRef.current;
    }

    const ffmpeg = ffmpegRef.current ?? new FFmpeg();

    ffmpegRef.current = ffmpeg;

    if (!ffmpeg.loaded) {
      const baseURL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/`;

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(
          `${baseURL}ffmpeg-core.wasm`,
          "application/wasm",
        ),
        workerURL: await toBlobURL(
          `${baseURL}ffmpeg-core.worker.js`,
          "text/javascript",
        ),
      });
    }

    setFfmpegReady(true);
    return ffmpeg;
  }, [ffmpegReady]);

  useEffect(() => {
    ensureFfmpeg().catch((error) => {
      console.error(error);
      setStage("error");
      setErrorMessage("بارگذاری موتور ویدیو ناموفق بود.");
    });
  }, [ensureFfmpeg]);

  useEffect(() => {
    if (ffmpegReady && stage === "idle") {
      setStatusMessage("همه چیز آماده است. عکس خود را انتخاب کنید.");
    }
  }, [ffmpegReady, stage]);

  const handleImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    setImageFile(file);
    setVideoUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return null;
    });
    setStage("idle");
    setStatusMessage(file ? "برای ساخت ویدیو روی دکمه زیر بزنید." : "همه چیز آماده است. عکس خود را انتخاب کنید.");
  }, []);

  const handleAudioChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setAudioFile(file);
  }, []);

  const generateVideo = useCallback(async () => {
    if (!imageFile) {
      setErrorMessage("لطفاً ابتدا عکس خود را انتخاب کنید.");
      setStatusMessage("برای شروع باید یک عکس انتخاب کنید.");
      setStage("error");
      return;
    }

    setStage("loading");
    setStatusMessage("در حال آماده‌سازی فایل‌ها...");
    setErrorMessage(null);

    try {
      const ffmpeg = await ensureFfmpeg();

      if (!ffmpeg) {
        throw new Error("ffmpeg not ready");
      }

      const baseFrame = await buildBaseFrame(imageFile, overlayText, accentColor);
      await ffmpeg.writeFile("frame.png", baseFrame);

      if (audioFile) {
        const audioData = await fetchFile(audioFile);
        await ffmpeg.writeFile("audio.mp3", audioData);
      }

      const totalFrames = duration * FRAME_RATE;
      const filters = [
        `zoompan=z='min(zoom+0.0015,1.3)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${totalFrames}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}`,
        "format=yuv420p",
      ];

      const args = [
        "-loop",
        "1",
        "-framerate",
        `${FRAME_RATE}`,
        "-i",
        "frame.png",
      ];

      if (audioFile) {
        args.push("-i", "audio.mp3");
      }

      args.push(
        "-t",
        `${duration}`,
        "-vf",
        filters.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
      );

      if (audioFile) {
        args.push("-shortest", "-c:a", "aac", "-b:a", "192k");
      }

      args.push("output.mp4");

      setStage("rendering");
      setStatusMessage("در حال رندر ویدیو...");

      const logListener = ({ message }: { message: string }) => {
        if (message.startsWith("frame=")) {
          setStatusMessage(`پیشرفت رندر: ${message}`);
        }
      };

      ffmpeg.on("log", logListener);

      try {
        await ffmpeg.exec(args);
      } finally {
        ffmpeg.off("log", logListener);
      }

      const outputData = await ffmpeg.readFile("output.mp4");

      if (typeof outputData === "string") {
        throw new Error("فرمت خروجی نامعتبر است.");
      }

      const videoBinary =
        outputData instanceof Uint8Array
          ? outputData.slice()
          : new Uint8Array(outputData);
      const videoBlob = new Blob([videoBinary.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(videoBlob);

      setVideoUrl(url);
      setStage("ready");
      setStatusMessage("ویدیو آماده دانلود است.");
    } catch (error) {
      console.error(error);
      setStage("error");
      setErrorMessage("ساخت ویدیو با مشکل مواجه شد. دوباره تلاش کنید.");
      setStatusMessage("ساخت ویدیو با مشکل مواجه شد.");
    } finally {
      const ffmpeg = ffmpegRef.current;

      if (ffmpeg) {
        try {
          await ffmpeg.deleteFile("frame.png");
        } catch (error) {
          console.warn("حذف فایل تصویر ناموفق بود", error);
        }

        try {
          await ffmpeg.deleteFile("output.mp4");
        } catch {
          // بی‌صدا
        }

        if (audioFile) {
          try {
            await ffmpeg.deleteFile("audio.mp3");
          } catch {
            // بی‌صدا
          }
        }
      }
    }
  }, [accentColor, audioFile, duration, ensureFfmpeg, imageFile, overlayText]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-rose-200 via-white to-sky-100 py-16">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6">
        <header className="flex flex-col gap-4 text-right">
          <span className="w-fit rounded-full bg-black/10 px-4 py-1 text-xs font-semibold text-black/60 backdrop-blur">
            سازنده فیلم از یک عکس
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
            با یک عکس، ویدیوی سینمایی بسازید
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-zinc-600">
            عکس خود را بارگذاری کنید، متن دلخواهتان را اضافه کنید و در چند لحظه خروجی mp4 تحویل بگیرید.
            همه چیز در مرورگر شما انجام می‌شود و فایل‌ها جایی ذخیره نمی‌شوند.
          </p>
        </header>

        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative flex flex-col gap-6 rounded-3xl bg-white/80 p-8 shadow-lg shadow-rose-100/60 backdrop-blur-md">
            <div className="space-y-4">
              <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 p-10 text-center transition hover:border-rose-400">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <span className="text-lg font-semibold text-rose-600">
                  عکس خود را انتخاب کنید
                </span>
                <span className="text-sm text-rose-400">
                  فرمت‌های JPG، PNG یا HEIC پشتیبانی می‌شود
                </span>
              </label>

              {imagePreview ? (
                <div className="overflow-hidden rounded-2xl border border-zinc-200">
                  <NextImage
                    src={imagePreview}
                    alt="پیش‌نمایش عکس"
                    width={VIDEO_WIDTH}
                    height={VIDEO_HEIGHT}
                    className="aspect-video w-full object-cover"
                    unoptimized
                  />
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 text-sm text-zinc-400">
                  پیش‌نمایش عکس انتخاب‌شده در اینجا نمایش داده می‌شود.
                </div>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-zinc-700">متن روی ویدیو</span>
                <textarea
                  value={overlayText}
                  onChange={(event) => setOverlayText(event.target.value)}
                  placeholder="احساس خود را بنویسید..."
                  className="min-h-[120px] rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-right text-sm text-zinc-700 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-zinc-700">رنگ تاکید متن</span>
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    className="h-10 w-10 cursor-pointer rounded-full border border-zinc-300 bg-white"
                  />
                  <span className="text-sm text-zinc-500">از رنگ برند یا حس خود استفاده کنید.</span>
                </div>
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-zinc-700">زمان ویدیو (ثانیه)</span>
                <input
                  type="range"
                  min={5}
                  max={20}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="accent-rose-500"
                />
                <div className="text-xs text-zinc-500 text-right">
                  طول ویدیو: {duration} ثانیه
                </div>
              </label>

              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-zinc-700">افزودن موسیقی پس‌زمینه (اختیاری)</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-xs text-zinc-500 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-rose-500/90 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
                />
                {audioFile ? (
                  <span className="text-xs text-zinc-500">فایل انتخاب شده: {audioFile.name}</span>
                ) : null}
                <span className="text-xs text-zinc-500">
                  اگر موسیقی انتخاب نکنید، ویدیو بدون صدا ذخیره می‌شود.
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={generateVideo}
              disabled={stage === "loading" || stage === "rendering"}
              className="mt-2 flex items-center justify-center rounded-2xl bg-rose-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-rose-200 transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-rose-300"
            >
              {stage === "loading" || stage === "rendering"
                ? "در حال ساخت ویدیو..."
                : "ساخت ویدیو"}
            </button>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 text-sm text-zinc-600">
              <strong className="block text-zinc-800">وضعیت:</strong>
              <span>{statusMessage}</span>
              {errorMessage ? (
                <span className="mt-2 block text-rose-600">{errorMessage}</span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-6 rounded-3xl bg-white/80 p-8 shadow-lg shadow-sky-100/60 backdrop-blur-md">
            <h2 className="text-2xl font-semibold text-zinc-900">خروجی نهایی</h2>

            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="aspect-video w-full overflow-hidden rounded-2xl border border-zinc-200 bg-black"
              />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-200 text-center text-sm text-zinc-400">
                هنوز ویدیویی ساخته نشده است.
                <span>بعد از ساخت، پیش‌نمایش در اینجا نمایش داده می‌شود.</span>
              </div>
            )}

            {videoUrl ? (
              <a
                href={videoUrl}
                download="movie-from-photo.mp4"
                className="flex items-center justify-center rounded-2xl bg-sky-500 px-6 py-4 text-sm font-semibold text-white shadow-lg shadow-sky-200 transition hover:bg-sky-600"
              >
                دانلود ویدیو
              </a>
            ) : null}

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600">
              <h3 className="text-base font-semibold text-zinc-800">راهنمای ساخت بهترین نتیجه</h3>
              <ul className="mt-3 space-y-2 text-right leading-6">
                <li>• از عکس‌های با کیفیت و نور مناسب استفاده کنید.</li>
                <li>• متن کوتاه انتخاب کنید تا خوانا بماند.</li>
                <li>• موسیقی انتخابی را کوتاه نگه دارید تا حجم فایل کم بماند.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

async function buildBaseFrame(
  imageFile: File,
  overlayText: string,
  accentColor: string,
): Promise<Uint8Array> {
  const source = await loadImageSource(imageFile);
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const context = canvas.getContext("2d");

  if (!context) {
    source.cleanup();
    throw new Error("canvas context is not available");
  }

  context.fillStyle = "#050505";
  context.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  const scale = Math.min(
    VIDEO_WIDTH / source.width,
    VIDEO_HEIGHT / source.height,
  );
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const offsetX = (VIDEO_WIDTH - drawWidth) / 2;
  const offsetY = (VIDEO_HEIGHT - drawHeight) / 2;

  source.draw(context, offsetX, offsetY, drawWidth, drawHeight);
  source.cleanup();

  const trimmedText = overlayText.trim();

  if (trimmedText.length > 0) {
    drawOverlayText(context, trimmedText, accentColor);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error("canvas blob not created"));
        return;
      }

      resolve(result);
    }, "image/png");
  });

  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function drawOverlayText(
  context: CanvasRenderingContext2D,
  text: string,
  accentColor: string,
): void {
  const fontSize = Math.round(VIDEO_HEIGHT * 0.065);
  const lineHeight = fontSize * 1.35;
  const maxWidth = VIDEO_WIDTH * 0.75;

  context.save();
  context.direction = "rtl";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `600 ${fontSize}px \"Vazirmatn\", \"IRANSans\", \"Segoe UI\", sans-serif`;

  const lines = wrapText(context, text, maxWidth);
  const totalHeight = lines.length * lineHeight;
  const backgroundHeight = totalHeight + fontSize * 0.9;
  const backgroundY = VIDEO_HEIGHT - backgroundHeight - 48;

  context.fillStyle = "rgba(0,0,0,0.45)";
  context.fillRect(
    (VIDEO_WIDTH - maxWidth) / 2 - 48,
    backgroundY,
    maxWidth + 96,
    backgroundHeight,
  );

  context.strokeStyle = accentColor;
  context.lineWidth = Math.max(4, fontSize * 0.08);

  lines.forEach((line, index) => {
    const y =
      backgroundY +
      backgroundHeight / 2 -
      (lines.length - 1) * lineHeight * 0.5 +
      index * lineHeight;

    context.shadowColor = "rgba(0,0,0,0.45)";
    context.shadowBlur = 12;
    context.strokeText(line, VIDEO_WIDTH / 2, y);
    context.shadowBlur = 0;
    context.fillStyle = "#ffffff";
    context.fillText(line, VIDEO_WIDTH / 2, y);
  });

  context.restore();
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (text.length === 0) {
    return [];
  }

  const paragraphSegments = text.split(/\s*\n+\s*/);
  const lines: string[] = [];

  paragraphSegments.forEach((segment) => {
    const words = segment.split(/\s+/);

    if (words.length === 0) {
      return;
    }

    let currentLine = words[0];

    for (let index = 1; index < words.length; index += 1) {
      const word = words[index];
      const testLine = `${currentLine} ${word}`;
      const metrics = context.measureText(testLine);

      if (metrics.width > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    lines.push(currentLine);
  });

  return lines;
}

type ImageSource = {
  width: number;
  height: number;
  draw: (
    context: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  cleanup: () => void;
};

async function loadImageSource(file: File): Promise<ImageSource> {
  try {
    const bitmap = await createImageBitmap(file);

    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, dx, dy, dw, dh) => {
        context.drawImage(bitmap, dx, dy, dw, dh);
      },
      cleanup: () => {
        bitmap.close();
      },
    } satisfies ImageSource;
  } catch {
    const objectUrl = URL.createObjectURL(file);

    try {
      const imageElement = await loadHtmlImage(objectUrl);

      return {
        width: imageElement.naturalWidth,
        height: imageElement.naturalHeight,
        draw: (context, dx, dy, dw, dh) => {
          context.drawImage(imageElement, dx, dy, dw, dh);
        },
        cleanup: () => {
          URL.revokeObjectURL(objectUrl);
        },
      } satisfies ImageSource;
    } catch (fallbackError) {
      URL.revokeObjectURL(objectUrl);
      throw fallbackError;
    }
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("بارگذاری تصویر ناموفق بود"));
    image.src = src;
  });
}
