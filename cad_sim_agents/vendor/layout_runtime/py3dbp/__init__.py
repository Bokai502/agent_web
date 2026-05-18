from __future__ import annotations

from py3dbp.models import Bin, Item
from py3dbp.packing import best_shelf_pack


class Packer:
    def __init__(self) -> None:
        self.bins: list[Bin] = []
        self.items: list[Item] = []

    def add_bin(self, bin: Bin) -> None:
        self.bins.append(bin)

    def add_item(self, item: Item) -> None:
        self.items.append(item)

    def pack(
        self,
        distribute_items: bool = False,
        bigger_first: bool = False,
        number_of_decimals: int = 0,
    ) -> None:
        if not self.bins:
            return
        bin = self.bins[0]
        placed, unfitted = best_shelf_pack(
            self.items,
            bin,
            bigger_first=bigger_first,
            number_of_decimals=number_of_decimals,
        )
        bin.items = placed
        bin.unfitted_items = unfitted


__all__ = ["Bin", "Item", "Packer"]
