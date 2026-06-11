# Component Derating Check Rules

This document defines the checking requirements for component derating information.
The input information comes from Table 5 in the component selection list.

## Input Fields

Each record should contain the following derating fields:

| Field | Meaning |
| --- | --- |
| Derating parameter | The parameter to be checked for derating, such as voltage, power, current, temperature, etc. |
| Rated value | The component rated parameter value. This is normally provided by the equipment/unit supplier and is generally determined from the component datasheet. |
| Allowed value | The maximum allowed parameter value after derating. |
| Actual value | The actual operating parameter value provided by the equipment/unit supplier. |
| Required derating factor | The derating factor required by the applicable standard and component category. |
| Actual derating factor | The actual derating factor calculated from the actual value and rated value. |
| Derating level | The derating level used for the check. |

The main purpose of the check is to determine whether the submitted derating information is complete and accurate.

## Rules

1. Completeness of derating parameters

   According to the GJB Z35 derating standard, different component categories require different derating parameters. Check whether all required derating parameters have been provided for the component category. Missing derating items must be marked.

2. Required derating factor and derating level

   Derating must be checked using Level I derating. The required derating factor must be checked against the derating factor defined for the corresponding component category. Incorrect derating factors or derating levels must be marked.

3. Rated value and allowed value

   The rated value is normally provided by the equipment/unit supplier and is generally determined from the component datasheet. The rated value itself does not need to be judged.

   The allowed value must be calculated as:

   ```text
   allowed value = rated value * required derating factor
   ```

   Use the correct required derating factor to determine whether the submitted allowed value is correct. Incorrect allowed values must be marked.

4. Actual value and actual derating factor

   The actual value is provided by the equipment/unit supplier and does not need to be judged directly.

   Check whether:

   ```text
   actual value <= allowed value
   ```

   If this condition is not met, mark the record.

   The actual derating factor must be calculated as:

   ```text
   actual derating factor = actual value / rated value
   ```

   Check whether:

   ```text
   actual derating factor <= required derating factor
   ```

   If this condition is not met, mark the record.

5. Temperature-related derating items

   If a derating item involves temperature, the temperature must not exceed 85 deg C. If the temperature exceeds 85 deg C, mark the record.

6. Output

   Summarize all marked issues and output the final checking result.
