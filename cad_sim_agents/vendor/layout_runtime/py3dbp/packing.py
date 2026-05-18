from __future__ import annotations

from py3dbp.models import Bin, Item


def best_shelf_pack(
    items: list[Item],
    bin: Bin,
    *,
    bigger_first: bool,
    number_of_decimals: int,
) -> tuple[list[Item], list[Item]]:
    best: tuple[list[Item], list[Item]] | None = None
    for ordered in _candidate_orders(items, bigger_first=bigger_first):
        placed, unfitted = shelf_pack(ordered, bin, number_of_decimals=number_of_decimals)
        if best is None or pack_score(placed, unfitted) > pack_score(*best):
            best = (placed, unfitted)
    return best or ([], list(items))


def shelf_pack(
    items: list[Item],
    bin: Bin,
    *,
    number_of_decimals: int,
) -> tuple[list[Item], list[Item]]:
    placed: list[Item] = []
    unfitted: list[Item] = []
    x = y = row_height = 0.0
    for item in items:
        width = round(float(item.width), number_of_decimals)
        height = round(float(item.height), number_of_decimals)
        if does_not_fit_bin(width, height, bin):
            unfitted.append(item)
            continue
        if needs_new_row(x, width, bin):
            x = 0.0
            y += row_height
            row_height = 0.0
        if does_not_fit_remaining_height(y, height, bin):
            unfitted.append(item)
            continue
        item.position = [x, y, 0.0]
        placed.append(item)
        x += width
        row_height = max(row_height, height)
    return placed, unfitted


def pack_score(placed: list[Item], unfitted: list[Item]) -> tuple[int, float, int]:
    used_area = sum(float(item.width) * float(item.height) for item in placed)
    return (len(placed), used_area, -len(unfitted))


def does_not_fit_bin(width: float, height: float, bin: Bin) -> bool:
    return width > bin.width or height > bin.height


def needs_new_row(x: float, width: float, bin: Bin) -> bool:
    return x + width > bin.width


def does_not_fit_remaining_height(y: float, height: float, bin: Bin) -> bool:
    return y + height > bin.height


def _candidate_orders(items: list[Item], *, bigger_first: bool) -> list[list[Item]]:
    base = list(items)
    if not bigger_first:
        return [base]
    return [
        sorted(base, key=lambda item: item.width * item.height * item.depth, reverse=True),
        sorted(base, key=lambda item: item.height, reverse=True),
        sorted(base, key=lambda item: item.width, reverse=True),
        sorted(base, key=lambda item: max(item.width, item.height), reverse=True),
        base,
    ]
