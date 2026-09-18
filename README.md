# `C++`|`cpp` Inlay Hints

This is a VS Code extension that adds inlay hints for C++ code, making them clickable, just like `.md` (*Markdown*) links, providing additional information such as ordinal, address, and size directly in the editor.

## Purpose

Some small context behind this extension: The open-source Nintendo DS clean-room, experimental, decompilation project of the 2004 game [*Super Mario 64 DS*](https://github.com/tangosdev/sm64ds-decomp), known as `sm64ds-decomp`, introduced, with PR [#2670](https://github.com/tangosdev/sm64ds-decomp/pull/2670), and reorganized the codebase, resulting in new cases of code cleanup comments prefixed with `// @symbol` such as:

```cpp
// @symbol _ZN7daBrq_c16CleanupResourcesEv
```

Inside the [src/game/actors/daBrq_c.cpp](https://github.com/tangosdev/sm64ds-decomp/blob/main/src/game/actors/daBrq_c.cpp) file itself, `_ZN7daBrq_c16CleanupResourcesEv` is the `mwccarm` compiler-mangled name for the function:

```cpp
 int daBrq_c::CleanupResources()
```

 However, the `cpp` file out-of-the-box does not provide any information in it's comments about the symbol's ordinal, size and address. It's just a plain comment text.

### Case-study

 The removed comment in the aforementioned [#2670](https://github.com/tangosdev/sm64ds-decomp/pull/2670) provides useful information about the function's signature, but developers still have to manually search for it in the codebase, which can be time-consuming and disrupt the workflow:

 ```cpp
/* -------------------------------------------------------------------------- */
/* ROM ordinal 13 -- _ZN7daBrq_c16CleanupResourcesEv, 0x02120dc4, size 0x5c */
/* -------------------------------------------------------------------------- */
```

 Digging deeper into search, we can find in the directory [config/tu_manifest.d](https://github.com/tangosdev/sm64ds-decomp/tree/main/config/tu_manifest.d) a list of overlay folders, with files in `.json` format. It's still a heavy WIP with many classes missing, but it provides a lot of useful information for the ones that are already present.

 The specific folder with the example function is [ov70](https://github.com/tangosdev/sm64ds-decomp/tree/main/config/tu_manifest.d/ov070), and the file is [daBrq_c.json](https://github.com/tangosdev/sm64ds-decomp/blob/main/config/tu_manifest.d/ov070/daBrq_c.json).

 Inside this file, we can find the function's ROM `"ordinal": 13`, useful for exact structure, as `mwccarm` assembles the TU in reverse order:

```json
{
      "symbol": "_ZN7daBrq_c16CleanupResourcesEv",
      "address": "0x02120dc4",
      "size": "0x0000005c",
      "legacy_source": "src/_ZN3Amp16CleanupResourcesEv.cpp",
      "ordinal": 13
    },
```

This extension aims to enhance the development experience by providing inlay hints for such cases, allowing developers to quickly access relevant information without leaving the source file.
