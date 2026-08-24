from __future__ import annotations

from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Callable, Protocol

from .config import Settings
from .models import Diagnostics, InputInfo, ModelInfo


ProgressCallback = Callable[[str, int], None]


class ProcessingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ProcessingResult:
    def __init__(self, input_info: InputInfo, diagnostics: Diagnostics, model: ModelInfo):
        self.input_info = input_info
        self.diagnostics = diagnostics
        self.model = model


class Runner(Protocol):
    @property
    def gpu_available(self) -> bool: ...

    @property
    def model_loaded(self) -> bool: ...

    def process(self, source: Path, output: Path, progress: ProgressCallback) -> ProcessingResult: ...


class YoloVideoRunner:
    """Lazy-loaded YOLO runner. Imports heavy GPU/video modules only on first use."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._model = None

    @property
    def gpu_available(self) -> bool:
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:
            return False

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def _load_model(self):
        if self._model is None:
            if not self.settings.model_path.is_file():
                raise ProcessingError("MODEL_NOT_FOUND", "足球检测模型文件不存在")
            try:
                from ultralytics import YOLO

                self._model = YOLO(str(self.settings.model_path))
            except Exception as exc:
                raise ProcessingError("MODEL_LOAD_FAILED", "足球检测模型加载失败") from exc
        return self._model

    def process(self, source: Path, output: Path, progress: ProgressCallback) -> ProcessingResult:
        try:
            import av
            import cv2
        except ImportError as exc:
            raise ProcessingError("RUNTIME_MISSING", "视频检测运行依赖不完整") from exc

        progress("probing", 1)
        capture = cv2.VideoCapture(str(source))
        if not capture.isOpened():
            raise ProcessingError("VIDEO_DECODE_FAILED", "无法读取该视频，请更换文件后重试")

        fps = float(capture.get(cv2.CAP_PROP_FPS))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0 or width <= 0 or height <= 0 or total_frames <= 0:
            capture.release()
            raise ProcessingError("VIDEO_DECODE_FAILED", "无法读取该视频，请更换文件后重试")
        duration = total_frames / fps
        if duration > self.settings.max_duration_seconds:
            capture.release()
            raise ProcessingError("VIDEO_TOO_LONG", "视频不能超过15分钟")

        input_info = InputInfo(
            filename=source.name,
            duration_seconds=round(duration, 2),
            width=width,
            height=height,
            fps=round(fps, 3),
        )
        model = self._load_model()
        names = model.names
        counts: Counter[str] = Counter()
        classes_seen: set[str] = set()
        processed = 0
        encoded_width = width + width % 2
        encoded_height = height + height % 2
        output.parent.mkdir(parents=True, exist_ok=True)

        try:
            container = av.open(str(output), mode="w", format="mp4")
            stream = container.add_stream("libx264", rate=Fraction(str(round(fps, 3))))
            stream.width = encoded_width
            stream.height = encoded_height
            stream.pix_fmt = "yuv420p"
            stream.options = {"preset": "veryfast", "crf": "24"}
        except Exception as exc:
            capture.release()
            raise ProcessingError(
                "H264_ENCODER_UNAVAILABLE",
                "当前环境不支持libx264/H.264编码，无法生成浏览器可播放的视频",
            ) from exc

        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                results = model.predict(
                    frame,
                    conf=self.settings.confidence,
                    device=self.settings.device,
                    verbose=False,
                )[0]
                annotated = frame.copy()
                if results.boxes is not None:
                    boxes = results.boxes.xyxy.detach().cpu().numpy()
                    classes = results.boxes.cls.detach().cpu().numpy().astype(int)
                    confidences = results.boxes.conf.detach().cpu().numpy()
                    for box, class_id, confidence in zip(boxes, classes, confidences):
                        label = str(names.get(class_id, class_id) if isinstance(names, dict) else names[class_id])
                        counts[label] += 1
                        classes_seen.add(label)
                        x1, y1, x2, y2 = (int(value) for value in box)
                        cv2.rectangle(annotated, (x1, y1), (x2, y2), (101, 214, 176), 2)
                        cv2.putText(
                            annotated,
                            f"{label} {confidence:.2f}",
                            (x1, max(18, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.55,
                            (101, 214, 176),
                            2,
                            cv2.LINE_AA,
                        )
                if encoded_width != width or encoded_height != height:
                    annotated = cv2.copyMakeBorder(
                        annotated,
                        0,
                        encoded_height - height,
                        0,
                        encoded_width - width,
                        cv2.BORDER_CONSTANT,
                        value=(0, 0, 0),
                    )
                video_frame = av.VideoFrame.from_ndarray(annotated, format="bgr24")
                for packet in stream.encode(video_frame):
                    container.mux(packet)
                processed += 1
                if processed == 1 or processed % max(1, total_frames // 100) == 0:
                    progress("detecting", min(94, 5 + int(processed / total_frames * 89)))

            if processed == 0:
                raise ProcessingError("VIDEO_DECODE_FAILED", "无法读取该视频，请更换文件后重试")
            progress("rendering", 96)
            for packet in stream.encode():
                container.mux(packet)
        except ProcessingError:
            raise
        except Exception as exc:
            raise ProcessingError("DETECTION_FAILED", "视频检测过程中发生错误") from exc
        finally:
            capture.release()
            container.close()

        if not output.is_file() or output.stat().st_size == 0:
            raise ProcessingError("VIDEO_RENDER_FAILED", "检测视频生成失败")

        return ProcessingResult(
            input_info=input_info,
            diagnostics=Diagnostics(
                processed_frames=processed,
                classes_seen=sorted(classes_seen),
                frame_detections_by_class=dict(sorted(counts.items())),
            ),
            model=ModelInfo(),
        )
