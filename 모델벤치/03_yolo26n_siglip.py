"""YOLO26n + SigLIP SO400M: video_1.mp4에서 person_1.png 검색."""

from time import perf_counter


if __name__ == "__main__":
    started = perf_counter()
    from search_benchmark import run

    run("yolo26n", "siglip", started)
