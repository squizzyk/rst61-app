# =============================================================================
# RST61 — Скрипт импорта 3D-модели компрессионной рубашки в Blender
# =============================================================================
# Использование: откройте Blender → Scripting → Open → выберите этот файл → Run Script
# Или: Edit → Preferences → File Paths (если нужно изменить путь ниже).
# =============================================================================

import bpy
import os

# ─── Конфигурация пути к файлу ──────────────────────────────────────────────
# ВАЖНО: используем raw-строку (r"..."), чтобы обратные слэши Windows
# не интерпретировались как escape-последовательности (\U, \Р и т.д.).
MODEL_PATH = r"C:\Users\bogda\OneDrive\Рабочий стол\baselayer_shirt_men.glb"


def import_glb_model(filepath):
    """
    Импортирует GLB-модель в текущую сцену Blender.
    Возвращает список импортированных объектов.
    """

    # Запоминаем все объекты, которые уже есть в сцене ДО импорта.
    # Это нужно, чтобы потом вычислить, какие объекты были добавлены.
    existing_objects = set(bpy.data.objects)

    # Импорт GLB/GLTF через встроенный оператор Blender.
    # merge_vertices=True — склеивает дублирующиеся вершины для чистой геометрии.
    bpy.ops.import_scene.gltf(filepath=filepath, merge_vertices=True)

    # Вычисляем разницу: новые объекты = (все объекты после импорта) - (старые).
    imported_objects = [obj for obj in bpy.data.objects if obj not in existing_objects]

    return imported_objects


def focus_viewport_on_objects(objects):
    """
    Выделяет импортированные объекты и фокусирует камеру вьюпорта на них.
    """

    # Снимаем выделение со всех объектов в сцене.
    bpy.ops.object.select_all(action='DESELECT')

    # Выделяем каждый импортированный объект.
    for obj in objects:
        obj.select_set(True)

    # Назначаем первый меш-объект как активный (для дальнейшей работы с ним).
    # Приоритет отдаём мешам, так как именно они содержат геометрию рубашки.
    active_candidate = None
    for obj in objects:
        if obj.type == 'MESH':
            active_candidate = obj
            break

    # Если меш-объектов нет — берём первый попавшийся импортированный.
    if active_candidate is None and objects:
        active_candidate = objects[0]

    if active_candidate:
        bpy.context.view_layer.objects.active = active_candidate

    # Фокусируем 3D-вьюпорт на выделенных объектах.
    # Для этого нужно найти активную область типа 'VIEW_3D' и выполнить оператор в её контексте.
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            with bpy.context.temp_override(area=area, region=area.regions[-1]):
                bpy.ops.view3d.view_selected(use_all_regions=False)
            break


def main():
    """
    Главная функция скрипта: проверяет файл, импортирует, фокусирует камеру.
    """

    print("=" * 60)
    print("RST61 — Импорт компрессионной рубашки")
    print("=" * 60)

    # ── Шаг 1: Проверяем, существует ли файл по указанному пути ──────────
    if not os.path.isfile(MODEL_PATH):
        print(f"[ОШИБКА] Файл не найден: {MODEL_PATH}")
        print("[ПОДСКАЗКА] Проверьте путь в переменной MODEL_PATH в начале скрипта.")
        return

    print(f"[OK] Файл найден: {MODEL_PATH}")

    # ── Шаг 2: Импортируем модель ────────────────────────────────────────
    try:
        imported = import_glb_model(MODEL_PATH)
    except Exception as e:
        print(f"[ОШИБКА] Не удалось импортировать модель: {e}")
        print("[ПОДСКАЗКА] Убедитесь, что файл — валидный GLB/GLTF и не повреждён.")
        return

    if not imported:
        print("[ПРЕДУПРЕЖДЕНИЕ] Импорт завершён, но новых объектов не обнаружено.")
        return

    # ── Шаг 3: Выводим информацию об импортированных объектах ─────────────
    print(f"[OK] Импортировано объектов: {len(imported)}")
    for obj in imported:
        obj_info = f"  • {obj.name} (тип: {obj.type})"
        if obj.type == 'MESH':
            obj_info += f", вершин: {len(obj.data.vertices)}, полигонов: {len(obj.data.polygons)}"
        print(obj_info)

    # ── Шаг 4: Фокусируем вьюпорт на импортированной модели ──────────────
    try:
        focus_viewport_on_objects(imported)
        active = bpy.context.view_layer.objects.active
        print(f"[OK] Активный объект: {active.name if active else 'не задан'}")
        print("[OK] Камера вьюпорта сфокусирована на модели.")
    except Exception as e:
        print(f"[ПРЕДУПРЕЖДЕНИЕ] Не удалось сфокусировать камеру: {e}")
        print("[ПОДСКАЗКА] Это может произойти при запуске в фоновом режиме (--background).")

    print("=" * 60)
    print("RST61 — Импорт завершён успешно. Модель готова к работе.")
    print("=" * 60)


# ── Точка входа ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    main()
