import os
import sys

from paraview.simple import *


file_name = os.environ.get("PARAVIEW_VTU_PATH")
if not file_name:
    print("PARAVIEW_VTU_PATH is not set", file=sys.stderr)
    sys.exit(2)

vtu = XMLUnstructuredGridReader(FileName=[file_name])
UpdatePipeline(proxy=vtu)

view = GetActiveViewOrCreate("RenderView")
view.ViewSize = [1600, 1000]
view.Background = [1.0, 1.0, 1.0]

display = Show(vtu, view)
display.Representation = "Surface With Edges"
display.LineWidth = 1.0


def array_names(attributes):
    if attributes is None:
        return []
    return [attributes.GetArray(i).Name for i in range(attributes.GetNumberOfArrays())]


point_arrays = array_names(vtu.PointData)
cell_arrays = array_names(vtu.CellData)
active_array = None
active_association = None

for candidate in ("T", "Color"):
    if candidate in point_arrays:
        active_array = candidate
        active_association = "POINTS"
        ColorBy(display, ("POINTS", candidate))
        break
    if candidate in cell_arrays:
        active_array = candidate
        active_association = "CELLS"
        ColorBy(display, ("CELLS", candidate))
        break

if active_array is None:
    if point_arrays:
        active_array = point_arrays[0]
        active_association = "POINTS"
        ColorBy(display, ("POINTS", active_array))
    elif cell_arrays:
        active_array = cell_arrays[0]
        active_association = "CELLS"
        ColorBy(display, ("CELLS", active_array))

display.RescaleTransferFunctionToDataRange(True, False)
if active_array:
    lut = GetColorTransferFunction(active_array)
    display.SetScalarBarVisibility(view, True)
    scalar_bar = GetScalarBar(lut, view)
    scalar_bar.Title = active_array
    scalar_bar.ComponentTitle = "K"

title = Text()
title.Text = file_name.rsplit("/", 1)[-1]
title_display = Show(title, view)
title_display.WindowLocation = "Upper Left Corner"
title_display.FontSize = 16
title_display.Color = [0.0, 0.0, 0.0]

ResetCamera(view)
camera = view.GetActiveCamera()
camera.Elevation(28)
camera.Azimuth(38)
camera.Roll(0)
ResetCamera(view)
view.StillRender()

print("Loaded VTU:", file_name)
print("Point arrays:", point_arrays)
print("Cell arrays:", cell_arrays)
print("Active coloring:", active_association, active_array)
