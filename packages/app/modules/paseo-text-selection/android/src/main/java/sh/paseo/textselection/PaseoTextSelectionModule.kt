package sh.paseo.textselection

import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.IdentityHashMap
import kotlin.math.max
import kotlin.math.min

private const val selectionEventName = "onTextSelection"

class PaseoTextSelectionModule : Module() {
  private data class AttachedTextView(
    val view: TextView,
    val originalCallback: ActionMode.Callback?,
    val callback: ActionMode.Callback,
  )

  private data class SurfaceBinding(
    val root: View,
    val textViews: IdentityHashMap<TextView, AttachedTextView>,
    val layoutListener: ViewTreeObserver.OnGlobalLayoutListener,
  )

  private data class ActiveSelection(val textView: TextView, val actionMode: ActionMode)

  private val bindings = mutableMapOf<String, SurfaceBinding>()
  private val activeSelections = mutableMapOf<String, ActiveSelection>()

  override fun definition() = ModuleDefinition {
    Name("PaseoTextSelection")
    Events(selectionEventName)

    AsyncFunction("registerSurface") { viewTag: Int, surfaceId: String ->
      registerSurface(viewTag, surfaceId)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unregisterSurface") { surfaceId: String ->
      unregisterSurface(surfaceId)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearSelection") { surfaceId: String ->
      clearSelection(surfaceId)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      bindings.keys.toList().forEach(::unregisterSurface)
      activeSelections.clear()
    }
  }

  private fun registerSurface(viewTag: Int, surfaceId: String) {
    unregisterSurface(surfaceId)
    val root = appContext.findView<View>(viewTag) ?: return
    val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
      refreshSurface(surfaceId)
    }
    val binding = SurfaceBinding(root, IdentityHashMap(), layoutListener)
    bindings[surfaceId] = binding
    root.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    refreshSurface(surfaceId)
  }

  private fun unregisterSurface(surfaceId: String) {
    activeSelections.remove(surfaceId)?.actionMode?.finish()
    val binding = bindings.remove(surfaceId) ?: return
    if (binding.root.viewTreeObserver.isAlive) {
      binding.root.viewTreeObserver.removeOnGlobalLayoutListener(binding.layoutListener)
    }
    binding.textViews.values.forEach { attached ->
      if (attached.view.customSelectionActionModeCallback === attached.callback) {
        attached.view.customSelectionActionModeCallback = attached.originalCallback
      }
    }
  }

  private fun refreshSurface(surfaceId: String) {
    val binding = bindings[surfaceId] ?: return
    val selectableViews = collectSelectableTextViews(binding.root)
    val currentViews = IdentityHashMap<TextView, Boolean>()
    selectableViews.forEach { currentViews[it] = true }

    binding.textViews.entries.toList().forEach { (textView, attached) ->
      if (currentViews.containsKey(textView)) return@forEach
      if (textView.customSelectionActionModeCallback === attached.callback) {
        textView.customSelectionActionModeCallback = attached.originalCallback
      }
      binding.textViews.remove(textView)
    }

    selectableViews.forEach { textView ->
      if (binding.textViews.containsKey(textView)) return@forEach
      val original = textView.customSelectionActionModeCallback
      val callback = SelectionActionModeCallback(surfaceId, textView, original)
      textView.customSelectionActionModeCallback = callback
      binding.textViews[textView] = AttachedTextView(textView, original, callback)
    }
  }

  private fun clearSelection(surfaceId: String) {
    activeSelections.remove(surfaceId)?.actionMode?.finish()
    emitInactive(surfaceId)
  }

  private fun collectSelectableTextViews(root: View): List<TextView> {
    val result = mutableListOf<TextView>()
    val visited = IdentityHashMap<View, Boolean>()

    fun visit(view: View) {
      if (visited.put(view, true) != null) return
      if (view is TextView && view.isTextSelectable) {
        result += view
      }
      if (view is ViewGroup) {
        for (index in 0 until view.childCount) {
          visit(view.getChildAt(index))
        }
      }
    }

    visit(root)
    return result
  }

  private inner class SelectionActionModeCallback(
    private val surfaceId: String,
    private val textView: TextView,
    private val delegate: ActionMode.Callback?,
  ) : ActionMode.Callback {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      val created = delegate?.onCreateActionMode(mode, menu) ?: true
      if (created) {
        activeSelections[surfaceId] = ActiveSelection(textView, mode)
        textView.post { emitSelection(surfaceId, textView, mode) }
      }
      return created
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      activeSelections[surfaceId] = ActiveSelection(textView, mode)
      textView.post { emitSelection(surfaceId, textView, mode) }
      return delegate?.onPrepareActionMode(mode, menu) ?: false
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      return delegate?.onActionItemClicked(mode, item) ?: false
    }

    override fun onDestroyActionMode(mode: ActionMode) {
      if (activeSelections[surfaceId]?.actionMode === mode) {
        activeSelections.remove(surfaceId)
      }
      emitInactive(surfaceId)
      delegate?.onDestroyActionMode(mode)
    }
  }

  private fun emitSelection(surfaceId: String, textView: TextView, mode: ActionMode) {
    if (activeSelections[surfaceId]?.actionMode !== mode) return
    val text = textView.text ?: return
    val rawStart = textView.selectionStart
    val rawEnd = textView.selectionEnd
    if (rawStart < 0 || rawEnd < 0 || rawStart == rawEnd) {
      emitInactive(surfaceId)
      return
    }

    val start = min(rawStart, rawEnd).coerceAtMost(text.length)
    val end = max(rawStart, rawEnd).coerceAtMost(text.length)
    val selectedText = text.subSequence(start, end).toString().trim()
    val layout = textView.layout
    if (selectedText.isEmpty() || layout == null) {
      emitInactive(surfaceId)
      return
    }

    val terminalOffset = (end - 1).coerceAtLeast(start)
    val line = layout.getLineForOffset(terminalOffset)
    val endLine = layout.getLineForOffset(end)
    val terminalX =
      if (endLine == line) layout.getPrimaryHorizontal(end) else layout.getLineRight(line)
    val location = IntArray(2)
    textView.getLocationInWindow(location)
    val anchorX =
      location[0] + textView.totalPaddingLeft + terminalX - textView.scrollX
    val anchorY =
      location[1] + textView.totalPaddingTop + layout.getLineBottom(line) - textView.scrollY
    val density = textView.resources.displayMetrics.density

    sendEvent(
      selectionEventName,
      mapOf(
        "surfaceId" to surfaceId,
        "active" to true,
        "text" to selectedText,
        "anchorX" to anchorX / density,
        "anchorY" to anchorY / density,
      ),
    )
  }

  private fun emitInactive(surfaceId: String) {
    sendEvent(selectionEventName, mapOf("surfaceId" to surfaceId, "active" to false))
  }
}
