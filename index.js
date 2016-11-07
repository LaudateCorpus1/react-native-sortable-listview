import React from 'react';
import TimerMixin from 'react-timer-mixin';
import {
  ListView,
  LayoutAnimation,
  View,
  Animated,
  Dimensions,
  PanResponder
} from 'react-native';

const HEIGHT = Dimensions.get('window').height;
const WRAPPER_REF = 'WRAPPER_REF';
const LIST_REF = 'LIST_REF';
const VIEW_REF = 'VIEW_REF';
const NONE_INDEX = -1;

const Row = React.createClass({
  _data: {},

  shouldComponentUpdate(props) {
    if (
      props.hovering !== this.props.hovering ||
      props.hoverIndex !== this.props.hoverIndex ||
      props.active !== this.props.active ||
      props.rowData.data !== this.props.rowData.data
    ) {
      return true;
    }

    if (props.rowHasChanged) {
      return props.rowHasChanged(props.rowData.data, this._data);
    }
    return false;
  },

  handleLongPress(e) {
    this.refs[VIEW_REF].measure((frameX, frameY, frameWidth, frameHeight, pageX, pageY) => {
      this.props.onRowActive({
        layout: {frameX, frameY, frameWidth, frameHeight, pageX, pageY},
        touch: e.nativeEvent,
        rowData: this.props.rowData
      });
    });
  },

  componentDidUpdate(props) {
    // Take a shallow copy of the active data. So we can do manual comparisons of rows if needed.
    if (props.rowHasChanged) {
      this._data = Object.assign({}, props.rowData.data);
    }
  },

  measure() {
    return this.refs[VIEW_REF].measure.apply(this, arguments);
  },

  render() {
    let activeData = this.props.list.state.active;

    let activeIndex = activeData ? Number(activeData.rowData.index) : NONE_INDEX;
    let shouldDisplayHovering = activeIndex !== this.props.rowData.index;

    let Row = React.cloneElement(
      this.props.renderRow(
        this.props.rowData.data,
        this.props.rowData.section,
        this.props.rowData.index,
        null,
        this.props.active
      ),
      {
        sortHandlers: {
          onLongPress: this.handleLongPress,
          onPressOut: this.props.list.cancel
        },
        onLongPress: this.handleLongPress,
        onPressOut: this.props.list.cancel
      }
    );

    return (
      // Height is 0.01 because https://github.com/facebook/react-native/issues/3397
      <View onLayout={this.props.onRowLayout}
            style={this.props.active && this.props.list.state.hovering ? {height: 0.01, opacity: 0} : null}
            ref={VIEW_REF}>
        {this.props.hovering && shouldDisplayHovering ? this.props.activeDivider : null}
        {Row}
      </View>
    );
  }
});

const SortRow = React.createClass({
  getInitialState() {
    let layout = this.props.list.state.active.layout;
    let wrapperLayout = this.props.list.wrapperLayout;

    return {
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        opacity: .25,
        overflow: 'hidden',
        backgroundColor: 'transparent',

        height: layout.frameHeight, // Row height
        marginTop: layout.pageY - wrapperLayout.frameY - layout.frameHeight
      }
    };
  },

  render() {
    const {rowData, sortRowStyle, list} = this.props;

    return (
      <Animated.View ref={VIEW_REF}
                     style={[this.state.style, sortRowStyle, list.state.pan.getLayout()]}>
        {this.props.renderRow(rowData.data, rowData.section, rowData.index, null, true)}
      </Animated.View>
    );
  }
});

const SortableListView = React.createClass({
  mixins: [TimerMixin],

  getInitialState() {
    const initialPanValue = {x: 0, y: 0};
    let itemHeight = 0;

    this.state = {
      dataSource: new ListView.DataSource({rowHasChanged: (r1, r2) => {
        if (this.props.rowHasChanged) return this.props.rowHasChanged(r1, r2);
        return false;
      }}),
      active: false,
      hovering: false,
      hoverIndex: NONE_INDEX,
      pan: new Animated.ValueXY(initialPanValue)
    };

    this.listener = this.state.pan.addListener(e => this.panY = e.y);

    let onPanResponderMoveCb = Animated.event([null, {
       dx: this.state.pan.x, // x,y are Animated.Value
       dy: this.state.pan.y,
    }]);

    this.state.panResponder = PanResponder.create({
      onStartShouldSetPanResponder: (e) => true,
      onMoveShouldSetPanResponderCapture: (e, a) => {
        // Only capture when moving vertically, this helps for child swiper rows.
        let vy = Math.abs(a.vy);
        let vx = Math.abs(a.vx);
        return vy > vx && this.state.active;
      },

      onPanResponderMove: (evt, gestureState) => {
        gestureState.dx = 0;
        this.moveY = gestureState.moveY + (itemHeight * .5);
        onPanResponderMoveCb(evt, gestureState);
      },

      onPanResponderGrant: (evt, gestureState) => {
        const {layout} = this.state.active;
        if (layout) {
          itemHeight = layout.frameHeight;
        }
        this.moved = true;
        this.state.pan.setOffset(initialPanValue);
        this.state.pan.setValue(initialPanValue);
        this.props.onMoveStart && this.props.onMoveStart();
      },

      onPanResponderRelease: (evt) => {
        this.moved = false;
        this.props.onMoveEnd && this.props.onMoveEnd();

        if (!this.state.active) {
          if (this.state.hovering) {
            this.setState({
              hovering: false,
              hoverIndex: NONE_INDEX
            });
          }
          this.moveY = null;
          return;
        }

        itemHeight = this.state.active.layout.frameHeight;
        let fromIndex = this.order.indexOf(this.state.active.rowData.index);
        let toIndex = this.state.hovering === false ? fromIndex : this.state.hoverIndex;
        let up = toIndex > fromIndex;

        if (up) {
          toIndex--;
        }

        if (toIndex === fromIndex) {
          return this.setState({active: false, hovering: false, hoverIndex: NONE_INDEX});
        }

        // Don't animate fromIndex -> toIndex after dropping, just drop.
        LayoutAnimation.configureNext({
          duration: 0
        });

        let args = {
          row: this.state.active.rowData,
          from: fromIndex,
          to: toIndex
        };

        this.props.onRowMoved && this.props.onRowMoved(args);

        this.setState({
          active: false,
          hovering: false,
          hoverIndex: NONE_INDEX,
          moveY: null
        });

        let MAX_HEIGHT = Math.max(0, this.scrollContainerHeight - this.listLayout.height + itemHeight);

        if (this.scrollValue > MAX_HEIGHT) {
          this.scrollResponder.scrollTo({y: MAX_HEIGHT});
        }
      }
    });

    return this.state;
  },

  cancel() {
    if (!this.moved) {
      this.setState({
        active: false,
        hovering: false,
        hoverIndex: NONE_INDEX
      });
    }
  },

  scrollTo(...args) {
    this.scrollResponder.scrollTo.apply(this.scrollResponder, args);
  },

  componentDidMount() {
    this.setTimeout(() => {
      this.scrollResponder = this.refs[LIST_REF].getScrollResponder();
      this.refs[WRAPPER_REF].measure((frameX, frameY, frameWidth, frameHeight, pageX, pageY) => {
        this.wrapperLayout = {frameX, frameY, frameWidth, frameHeight, pageX, pageY};
      });
    }, 1);
  },

  scrollValue: 0,

  // Gets calculated on scroll, but if you havent scrolled needs an initial value
  scrollContainerHeight: HEIGHT,

  scrollAnimation() {
    if (this.isMounted() && this.state.active) {
      if (this.moveY == undefined) {
        return this.requestAnimationFrame(this.scrollAnimation);
      }

      let SCROLL_OFFSET = this.wrapperLayout.pageY;
      let moveY = this.moveY - SCROLL_OFFSET;
      let SCROLL_LOWER_BOUND = 80;
      let SCROLL_HIGHER_BOUND = this.listLayout.height - SCROLL_LOWER_BOUND;

      let MAX_SCROLL_VALUE = this.scrollContainerHeight - this.listLayout.height + (this.state.active.layout.frameHeight * 2);
      let currentScrollValue = this.scrollValue;
      let newScrollValue = null;
      let SCROLL_MAX_CHANGE = 20;

      if (moveY < SCROLL_LOWER_BOUND && currentScrollValue > 0) {
        let PERCENTAGE_CHANGE = 1 - (moveY / SCROLL_LOWER_BOUND);
        newScrollValue = currentScrollValue - (PERCENTAGE_CHANGE * SCROLL_MAX_CHANGE);
        if (newScrollValue < 0) newScrollValue = 0;
      }
      if (moveY > SCROLL_HIGHER_BOUND && currentScrollValue < MAX_SCROLL_VALUE) {
        let PERCENTAGE_CHANGE = 1 - ((this.listLayout.height - moveY) / SCROLL_LOWER_BOUND);
        newScrollValue = currentScrollValue + (PERCENTAGE_CHANGE * SCROLL_MAX_CHANGE);
        if (newScrollValue > MAX_SCROLL_VALUE) newScrollValue = MAX_SCROLL_VALUE;
      }
      if (newScrollValue !== null) {
        this.scrollValue = newScrollValue;
        this.scrollResponder.scrollTo({y: this.scrollValue, x: 0, animated: false});
      }
      this.checkTargetElement();
      this.requestAnimationFrame(this.scrollAnimation);
    }
  },

  checkTargetElement() {
    let scrollValue = this.scrollValue;
    let moveY = this.moveY;
    let targetPixel = scrollValue + moveY - this.firstRowY;
    let i = 0;
    let x = 0;
    let row;
    let order = this.order;
    let isLast = false;
    while (i < targetPixel) {
      let key = order[x];
      row = this.layoutMap[key];
      if (!row) {
        isLast = true;
        break;
      }
      i += row.height;
      x++;
    }
    if (!isLast) x--;
    if (x != this.state.hovering) {
      LayoutAnimation.easeInEaseOut();

      this.setState({
        hovering: true,
        hoverIndex: x
      })
    }
  },

  firstRowY: undefined,
  layoutMap: {},
  _rowRefs: {},

  handleRowActive(row) {
    if (this.props.disableSorting) return;
    this.state.pan.setValue({x: 0, y: 0});
    LayoutAnimation.easeInEaseOut();
    this.moveY = row.layout.pageY;
    this.setState({
      active: row,
      hovering: true,
      hoverIndex: row.rowData.index
    }, this.scrollAnimation);
  },

  renderActiveDivider() {
    let height = this.state.active ? this.state.active.layout.frameHeight : null;

    if (this.props.renderActiveDivider) {
      return this.props.renderActiveDivider(height);
    }
    return <View style={{height}} />
  },

  renderRow(data, section, index, highlightfn, active) {
    let Component = active ? SortRow : Row;
    let isActiveRow = (!active && this.state.active && this.state.active.rowData.index === index);

    if (!active && isActiveRow) {
      active = {active: true};
    }
    let hoveringIndex = this.order[this.state.hoverIndex];

    return (
      <Component
        {...this.props}
        activeDivider={this.renderActiveDivider()}
        key={index}
        active={active}
        list={this}
        ref={view => { this._rowRefs[active ? 'ghost' : index] = view; }}
        hovering={hoveringIndex == index}
        panResponder={this.state.panResponder}
        rowData={{data, section, index}}
        onRowActive={this.handleRowActive}
        onRowLayout={layout => this._updateLayoutMap(index, layout.nativeEvent.layout)}
      />
    );
  },

  _updateLayoutMap(index, layout) {
    if (!this.firstRowY || layout.y < this.firstRowY) {
      this.firstRowY = layout.y;
    }
    this.layoutMap[index] = layout;
  },

  renderActive() {
    if (!this.state.active) return;
    let index = this.state.active.rowData.index;
    return this.renderRow(this.props.data[index], 's1', index, () => {}, {active: true, thumb: true});
  },

  componentWillMount() {
    this.setOrder(this.props);
  },

  componentWillReceiveProps(props) {
    this.setOrder(props);
  },

  setOrder(props) {
    this.order = props.order || Object.keys(props.data);
  },

  getScrollResponder() {
    return this.scrollResponder;
  },

  render() {
    let dataSource = this.state.dataSource.cloneWithRows(this.props.data, this.props.order);

    return (
      <View ref={WRAPPER_REF} style={{flex: 1}} onLayout={()=>{}}>
        <ListView
          renderHeader={() => this.props.header}
          ref={LIST_REF}
          enableEmptySections={true}
          {...this.props}
          {...this.state.panResponder.panHandlers}
          dataSource={dataSource}
          onScroll={e => {
            this.scrollValue = e.nativeEvent.contentOffset.y;
            if (this.props.onScroll) this.props.onScroll(e);
          }}
          onContentSizeChange={(width, height) => {
            this.scrollContainerHeight = height;
          }}
          onLayout={(e) => this.listLayout = e.nativeEvent.layout}
          scrollEnabled={!this.state.active && (this.props.scrollEnabled !== false)}
          renderRow={this.renderRow}
        />
        {this.renderActive()}
      </View>
    );
  }
});

export default SortableListView;
