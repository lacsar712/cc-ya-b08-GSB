"""阵风滤波闸的判定规则（纯函数，不碰数据库）。

写口（POST /api/logs）与专页指示灯（GET /api/gust-filter）必须共用本模块，
保证「同口径」；前端禁止自算中位数做演示。

口径：
  1. 取最近 window_size 条「已入队」读数的偏航误差，求窗内中位 m；
  2. 容差带 tol = max(floor_deg, median_multiplier * |m|)
     （偏航对中的正常值本身就在 0° 附近，中位接近 0 时倍数带宽会塌成 0，
      故用 floor_deg 保底，避免开闸后把一切正常小波动都误杀）；
  3. |本次读数 - m| > tol 即判为阵风尖峰，整单退回，不进入待处理队列。
窗内尚无已入队读数（没有基线）时不拦截，避免开闸初期无差别误杀。
被拒收的读数不进入基线窗口（尖峰不能污染中位）。
"""

from statistics import median as _statistics_median


def window_median(values):
    """窗内已入队读数的中位数；空窗返回 None。"""
    seq = [float(v) for v in values]
    if not seq:
        return None
    return float(_statistics_median(seq))


def tolerance_band(med, multiplier, floor_deg):
    """容差带 = max(保底宽度, 倍数×|中位|)；无中位时返回 None。"""
    if med is None:
        return None
    return max(float(floor_deg), float(multiplier) * abs(float(med)))


def evaluate(yaw_err_deg, window_values, *, window_size, median_multiplier, floor_deg):
    """按统一口径判定一笔读数是否放行。

    返回 dict：accepted / median / deviation / tolerance / reason。
    写口据此决定入队还是整单退回；专页用同一组函数展示中位与容差。
    """
    med = window_median(window_values)
    value = float(yaw_err_deg)

    if med is None:
        return {
            "accepted": True,
            "median": None,
            "deviation": None,
            "tolerance": None,
            "reason": "窗内无已入队读数作为基线，放行",
        }

    tol = tolerance_band(med, median_multiplier, floor_deg)
    deviation = abs(value - med)

    if deviation > tol:
        return {
            "accepted": False,
            "median": med,
            "deviation": deviation,
            "tolerance": tol,
            "reason": (
                f"阵风尖峰：读数 {value}° 相对窗内中位 {med:.3f}° 突变 "
                f"{deviation:.3f}°，超过容差 {tol:.3f}°（窗长 {window_size}、"
                f"中位倍数 {median_multiplier}），整单退回"
            ),
        }

    return {
        "accepted": True,
        "median": med,
        "deviation": deviation,
        "tolerance": tol,
        "reason": (
            f"读数 {value}° 相对窗内中位 {med:.3f}° 偏差 {deviation:.3f}° "
            f"≤ 容差 {tol:.3f}°，放行"
        ),
    }
