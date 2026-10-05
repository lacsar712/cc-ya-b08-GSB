"""偏航对中判定与阵风滤波规则。

- judge：绝对值不超过 1.5 度为合格。
- evaluate_gust：以最近 N-1 笔已入队读数为窗口，用中位数 + 中位绝对偏差
  （MAD）判定当前读数是否为阵风突变。写口与专页试算指示灯必须共用此函数，
  保证同口径；前端不得自行计算中位数。
"""

import statistics
from typing import Optional

THRESHOLD_DEG = 1.5

MIN_WINDOW = 3
MAX_WINDOW = 51
MIN_MULTIPLIER = 0.1
MAX_MULTIPLIER = 20.0


def judge(yaw_err_deg: float) -> tuple[str, str]:
    if abs(yaw_err_deg) <= THRESHOLD_DEG:
        return "合格", f"偏航误差 {yaw_err_deg}° 在 ±{THRESHOLD_DEG}° 以内"
    return "偏航超差", f"偏航误差 {yaw_err_deg}° 超过 ±{THRESHOLD_DEG}°"


def normalize_window(raw) -> int:
    """窗长必须是 3..51 的奇数。"""
    try:
        window = int(raw)
    except (TypeError, ValueError):
        raise ValueError("窗长必须是整数")
    if window < MIN_WINDOW or window > MAX_WINDOW:
        raise ValueError(f"窗长须在 {MIN_WINDOW}..{MAX_WINDOW} 之间")
    if window % 2 == 0:
        raise ValueError("窗长必须为奇数")
    return window


def normalize_multiplier(raw) -> float:
    try:
        multiplier = float(raw)
    except (TypeError, ValueError):
        raise ValueError("中位倍数必须是数字")
    if not (MIN_MULTIPLIER <= multiplier <= MAX_MULTIPLIER):
        raise ValueError(f"中位倍数须在 {MIN_MULTIPLIER}..{MAX_MULTIPLIER} 之间")
    return multiplier


def evaluate_gust(
    value: float,
    window_values: list[float],
    window_size: int,
    multiplier: float,
) -> dict:
    """判定单笔读数是否为阵风突变。

    窗口由最近 ``window_size - 1`` 笔已入队读数构成（候选读数尚未入队，
    不参与窗口），窗口不足时放行。MAD 为 0（窗内读数完全一致）时，只要
    候选与中位存在任何偏差即视为突变。

    返回字段：accepted / reason / median / mad / deviation / threshold /
    insufficient。
    """
    need = window_size - 1
    recent = [float(v) for v in window_values][-need:]
    if len(recent) < need:
        return {
            "accepted": True,
            "insufficient": True,
            "median": None,
            "mad": None,
            "deviation": None,
            "threshold": None,
            "reason": (
                f"有效窗内读数不足（{len(recent)}/{need}），不拦截"
            ),
        }

    med = statistics.median(recent)
    mad = statistics.median([abs(v - med) for v in recent])
    deviation = abs(float(value) - med)
    threshold = multiplier * mad

    if mad == 0.0:
        accepted = deviation == 0.0
        threshold_desc = 0.0
    else:
        accepted = deviation <= threshold
        threshold_desc = threshold

    if accepted:
        reason = (
            f"偏差 {deviation:.3f}° 未超过 {multiplier:g}×MAD 阈值 "
            f"{threshold_desc:.3f}°（窗内中位 {med:.3f}°）"
        )
    else:
        reason = (
            f"阵风突变：读数 {float(value):.3f}° 相对窗内中位 {med:.3f}° "
            f"偏差 {deviation:.3f}° 超过 {multiplier:g}×MAD 阈值 "
            f"{threshold_desc:.3f}°，整单退回"
        )

    return {
        "accepted": accepted,
        "insufficient": False,
        "median": med,
        "mad": mad,
        "deviation": deviation,
        "threshold": threshold_desc,
        "reason": reason,
    }
